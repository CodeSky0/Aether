// @aether/web · OAuth App Registry 服务层（授权流程 + token 兑换）
// 职责：authorize 请求校验（app / redirect_uri / scope / PKCE）→ 同意页
// 上下文组装 → code 签发（哈希入库，一次性）→ token 兑换（全量校验 +
// 轮换吊销 + 审计，事务）。App 与授权的管理 Server Actions 在 actions.ts。
// 禁止 'use server'（页面 / 路由直接调用，非 action 端点）。
import { and, eq, isNull } from 'drizzle-orm'

import { members, oauthApps, oauthAuthorizations, realms } from '@aether/db'
import {
  generateAccessToken,
  generateAuthorizationCode,
  matchesRedirectUri,
  OAUTH_CODE_TTL_MS,
  parseOAuthScopes,
  sha256Hex,
  verifyPkceS256,
} from '@aether/resonance'
import { recordPermissionChange } from '@/lib/audit-write'
import type { CoreDatabase } from '@/lib/resonance/core'
import { oauthError } from './protocol'
import type { AuthorizeQuery, TokenRequest } from './protocol'

// ---- authorize 校验与同意页上下文 ----

export interface AuthorizeConsentContext {
  app: { id: string; name: string; clientId: string }
  realm: { id: string; name: string; slug: string }
  scopes: readonly string[]
  state: string | undefined
  redirectUri: string
  codeChallenge: string | undefined
}

export type AuthorizeValidation =
  | { ok: true; context: AuthorizeConsentContext }
  | { ok: false; error: string }

/**
 * 校验 authorize 查询参数（fail-closed）：
 *   app 存在未删 + realm 匹配 + redirect_uri 精确匹配 + scope 合法。
 * 失败一律渲染错误页（不重定向，杜绝 open redirect）。
 */
export async function validateAuthorizeRequest(
  db: CoreDatabase,
  query: AuthorizeQuery,
): Promise<AuthorizeValidation> {
  const [app] = await db
    .select({
      id: oauthApps.id,
      name: oauthApps.name,
      client_id: oauthApps.client_id,
      realm_id: oauthApps.realm_id,
      redirect_uris: oauthApps.redirect_uris,
    })
    .from(oauthApps)
    .where(
      and(
        eq(oauthApps.client_id, query.client_id),
        isNull(oauthApps.deleted_at),
      ),
    )
    .limit(1)
  if (!app || app.realm_id !== query.realm_id) {
    return { ok: false, error: 'Unknown client_id for this realm.' }
  }
  if (!matchesRedirectUri(query.redirect_uri, app.redirect_uris)) {
    return { ok: false, error: 'redirect_uri is not registered for this app.' }
  }

  const [realm] = await db
    .select({ id: realms.id, name: realms.name, slug: realms.slug })
    .from(realms)
    .where(and(eq(realms.id, query.realm_id), isNull(realms.deleted_at)))
    .limit(1)
  if (!realm) {
    return { ok: false, error: 'Realm not found.' }
  }

  const scopes = parseOAuthScopes(query.scope)
  if (scopes === null) {
    return { ok: false, error: 'Invalid scope.' }
  }

  return {
    ok: true,
    context: {
      app: { id: app.id, name: app.name, clientId: app.client_id },
      realm: { id: realm.id, name: realm.name, slug: realm.slug },
      scopes,
      state: query.state,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
    },
  }
}

/** 构造重定向回应用的 URL（携带 code+state 或 error+state）。 */
export function buildAuthorizeRedirect(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

// ---- code 签发（用户批准后调用）----

export interface IssueCodeInput {
  context: AuthorizeConsentContext
  /** 批准授权的会话用户（Better-Auth user id）。 */
  userId: string
}

export interface IssuedCode {
  code: string
}

/** 批准授权：生成一次性 code（sha256 入库，10 分钟），并落权限委托审计。 */
export async function issueAuthorizationCode(
  db: CoreDatabase,
  input: IssueCodeInput,
): Promise<IssuedCode> {
  const code = generateAuthorizationCode()
  const codeHash = await sha256Hex(code)
  const { context } = input

  await db.transaction(async (tx) => {
    await tx.insert(oauthAuthorizations).values({
      app_id: context.app.id,
      realm_id: context.realm.id,
      user_id: input.userId,
      scopes: [...context.scopes],
      redirect_uri: context.redirectUri,
      code_hash: codeHash,
      code_expires_at: new Date(Date.now() + OAUTH_CODE_TTL_MS),
      code_challenge: context.codeChallenge ?? null,
      code_challenge_method: context.codeChallenge ? 'S256' : null,
    })
    await recordPermissionChange(tx, {
      realmId: context.realm.id,
      actor: { actorType: 'human', actorId: input.userId },
      target: {
        kind: 'oauth_authorization',
        app_id: context.app.id,
        client_id: context.app.clientId,
        scopes: context.scopes,
        code_challenge: context.codeChallenge !== undefined,
      },
      idempotencyKey: `oauth:authorize:${context.app.id}:${input.userId}:${Date.now()}`,
      result: { granted: true, scopes: context.scopes },
    })
  })
  return { code }
}

// ---- token 兑换 ----

export interface TokenGrant {
  access_token: string
  token_type: 'Bearer'
  scope: string
}

/**
 * 兑换 access token（事务，RFC 6749 §5.2 错误形状）：
 *   1. app 查找（client_id 未删）+ client_secret 哈希比较；
 *   2. code 行查找（哈希）→ 未过期 / 未兑换 / app 匹配 / redirect_uri
 *      一致 / PKCE（authorize 带 challenge 则 verifier 必填且 S256 匹配）；
 *   3. 事务：标记 exchanged_at + 轮换吊销同 (app,user,realm) 旧 token +
 *      写入 token 哈希 + 审计；
 *   4. 明文 token 仅本次响应返回。
 * 认证失败 invalid_client（401）；其余 invalid_grant / invalid_request（400）。
 */
export async function exchangeToken(
  db: CoreDatabase,
  request: TokenRequest,
): Promise<Response> {
  const [app] = await db
    .select({
      id: oauthApps.id,
      realm_id: oauthApps.realm_id,
      client_secret_hash: oauthApps.client_secret_hash,
    })
    .from(oauthApps)
    .where(
      and(
        eq(oauthApps.client_id, request.client_id),
        isNull(oauthApps.deleted_at),
      ),
    )
    .limit(1)
  if (!app || (await sha256Hex(request.client_secret)) !== app.client_secret_hash) {
    return oauthError(401, 'invalid_client', 'Client authentication failed.')
  }

  const codeHash = await sha256Hex(request.code)
  const [grant] = await db
    .select({
      id: oauthAuthorizations.id,
      app_id: oauthAuthorizations.app_id,
      realm_id: oauthAuthorizations.realm_id,
      user_id: oauthAuthorizations.user_id,
      scopes: oauthAuthorizations.scopes,
      redirect_uri: oauthAuthorizations.redirect_uri,
      code_expires_at: oauthAuthorizations.code_expires_at,
      code_challenge: oauthAuthorizations.code_challenge,
      exchanged_at: oauthAuthorizations.exchanged_at,
      revoked_at: oauthAuthorizations.revoked_at,
    })
    .from(oauthAuthorizations)
    .where(eq(oauthAuthorizations.code_hash, codeHash))
    .limit(1)
  if (
    !grant ||
    grant.app_id !== app.id ||
    grant.exchanged_at !== null ||
    grant.revoked_at !== null ||
    grant.code_expires_at.getTime() <= Date.now()
  ) {
    return oauthError(400, 'invalid_grant', 'Authorization code is invalid or expired.')
  }
  if (request.redirect_uri !== grant.redirect_uri) {
    return oauthError(400, 'invalid_grant', 'redirect_uri does not match.')
  }
  if (grant.code_challenge !== null) {
    if (request.code_verifier === undefined) {
      return oauthError(400, 'invalid_grant', 'code_verifier is required.')
    }
    if (!(await verifyPkceS256(request.code_verifier, grant.code_challenge))) {
      return oauthError(400, 'invalid_grant', 'PKCE verification failed.')
    }
  }

  const accessToken = generateAccessToken()
  const accessTokenHash = await sha256Hex(accessToken)
  const now = new Date()

  await db.transaction(async (tx) => {
    // 轮换收敛：吊销同 (app, user, realm) 下既有有效 token
    await tx
      .update(oauthAuthorizations)
      .set({ revoked_at: now })
      .where(
        and(
          eq(oauthAuthorizations.app_id, grant.app_id),
          eq(oauthAuthorizations.user_id, grant.user_id),
          eq(oauthAuthorizations.realm_id, grant.realm_id),
          isNull(oauthAuthorizations.revoked_at),
        ),
      )
    await tx
      .update(oauthAuthorizations)
      .set({
        exchanged_at: now,
        token_hash: accessTokenHash,
        token_prefix: accessToken.slice(0, 12),
        token_issued_at: now,
      })
      .where(eq(oauthAuthorizations.id, grant.id))
    await recordPermissionChange(tx, {
      realmId: grant.realm_id,
      actor: { actorType: 'human', actorId: grant.user_id },
      target: {
        kind: 'oauth_token',
        app_id: grant.app_id,
        authorization_id: grant.id,
        scopes: grant.scopes,
      },
      idempotencyKey: `oauth:token:${grant.id}`,
      result: { issued: true, scopes: grant.scopes },
    })
  })

  return Response.json({
    access_token: accessToken,
    token_type: 'Bearer',
    scope: grant.scopes.join(' '),
  } satisfies TokenGrant)
}

// ---- Bearer token 解析（供 resonance 鉴权层调用）----

export interface ResolvedOAuthToken {
  authorizationId: string
  appId: string
  appName: string
  clientId: string
  userId: string
  scopes: string[]
  realm: {
    id: string
    slug: string
    name: string
    created_at: Date
    updated_at: Date
  }
}

/**
 * 解析 OAuth access token（fail-closed，三重校验）：
 *   1. authorization 行存在：token_hash 命中 + 未吊销 + token 已签发；
 *   2. 绑定 App 未软删除；
 *   3. Realm 未软删除；
 *   4. 授权用户仍是该 Realm 的 active human member。
 * 任一不满足返回 null（统一 401，不区分失败原因）。
 */
export async function resolveOAuthToken(
  db: CoreDatabase,
  token: string,
): Promise<ResolvedOAuthToken | null> {
  const [row] = await db
    .select({
      authorizationId: oauthAuthorizations.id,
      appId: oauthApps.id,
      appName: oauthApps.name,
      clientId: oauthApps.client_id,
      userId: oauthAuthorizations.user_id,
      scopes: oauthAuthorizations.scopes,
      realmId: realms.id,
      realmSlug: realms.slug,
      realmName: realms.name,
      realmCreatedAt: realms.created_at,
      realmUpdatedAt: realms.updated_at,
    })
    .from(oauthAuthorizations)
    .innerJoin(
      oauthApps,
      and(eq(oauthApps.id, oauthAuthorizations.app_id), isNull(oauthApps.deleted_at)),
    )
    .innerJoin(
      realms,
      and(eq(realms.id, oauthAuthorizations.realm_id), isNull(realms.deleted_at)),
    )
    .where(
      and(
        eq(oauthAuthorizations.token_hash, await sha256Hex(token)),
        isNull(oauthAuthorizations.revoked_at),
      ),
    )
    .limit(1)
  if (!row) return null

  const [membership] = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.realm_id, row.realmId),
        eq(members.actor_type, 'human'),
        eq(members.actor_id, row.userId),
        isNull(members.project_id),
        eq(members.status, 'active'),
      ),
    )
    .limit(1)
  if (!membership) return null

  return {
    authorizationId: row.authorizationId,
    appId: row.appId,
    appName: row.appName,
    clientId: row.clientId,
    userId: row.userId,
    scopes: row.scopes,
    realm: {
      id: row.realmId,
      slug: row.realmSlug,
      name: row.realmName,
      created_at: row.realmCreatedAt,
      updated_at: row.realmUpdatedAt,
    },
  }
}
