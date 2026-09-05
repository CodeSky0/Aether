// @aether/web · Resonance Gateway 鉴权层（/api/v1）
// 职责：Bearer 令牌解析（双通道：aeth_ API Key / aoat_ OAuth token）→
// 哈希查找 → Realm 存活 → membership 三重 fail-closed 校验 →
// OAuth scope 按 method 强制 → last_used_at 维护。
// 先哈希再走唯一索引查找，杜绝明文比对与时序侧信道。
import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'

import { apiKeys, members, oauthAuthorizations, realms } from '@aether/db'
import { scopeAllowsMethod } from '@aether/resonance'
import { getDb } from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { resolveOAuthToken } from '@/lib/oauth/service'
import { apiError, notFound, unauthorized } from './protocol'

const logger = createLogger('resonance:auth')

/** API Key 明文前缀（与 lib/api-keys.ts 的生成格式一致）。 */
const API_KEY_PREFIX = 'aeth_'
/** OAuth access token 明文前缀（@aether/resonance/oauth 生成）。 */
const OAUTH_TOKEN_PREFIX = 'aoat_'

/** 解析 Authorization 头；非 Bearer / 空 / 前缀不识别返回 null。 */
export function parseBearerKey(
  authorization: string | null,
): string | null {
  if (!authorization) return null
  const scheme = authorization.slice(0, 7).toLowerCase()
  if (scheme !== 'bearer ') return null
  const token = authorization.slice(7)
  const isApiKey = token.startsWith(API_KEY_PREFIX) && token.length > API_KEY_PREFIX.length
  const isOAuth =
    token.startsWith(OAUTH_TOKEN_PREFIX) && token.length > OAUTH_TOKEN_PREFIX.length
  if (!isApiKey && !isOAuth) return null
  return token
}

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export interface ResolvedApiKey {
  /** API Key id 或 OAuth authorization id。 */
  keyId: string
  /** API Key 名或 OAuth App 名。 */
  keyName: string
  /** 委托主体（Better-Auth user id）：API Key 创建者或 OAuth 授权用户。 */
  creatorId: string
  realm: {
    id: string
    slug: string
    name: string
    created_at: Date
    updated_at: Date
  }
  /** 令牌通道（M3.19 起；API Key 场景为 'api-key'）。 */
  kind: 'api-key' | 'oauth-token'
  /** OAuth 通道：App 的公开 client_id。 */
  clientId?: string
  /** OAuth 通道：授权 scope（scope 强制依据）。 */
  scopes?: readonly string[]
}

/**
 * 解析并校验 Bearer 令牌（fail-closed，双通道）：
 *   aeth_ → api_keys 哈希查找（原逻辑不变）；
 *   aoat_ → oauth_authorizations 哈希查找（resolveOAuthToken）。
 * 通道共同的校验：行存在未吊销 + Realm 未软删除 + 委托主体仍是该 Realm
 * 的 active human member。任一不满足返回 null → 调用方统一 401。
 */
export async function resolveApiKey(
  authorization: string | null,
): Promise<ResolvedApiKey | null> {
  const token = parseBearerKey(authorization)
  if (token === null) return null
  const db = getDb()

  if (token.startsWith(OAUTH_TOKEN_PREFIX)) {
    const resolved = await resolveOAuthToken(db, token)
    if (resolved === null) {
      logger.warn('OAuth token lookup failed (unknown, revoked, or membership lost)')
      return null
    }
    return {
      keyId: resolved.authorizationId,
      keyName: resolved.appName,
      creatorId: resolved.userId,
      realm: resolved.realm,
      kind: 'oauth-token',
      clientId: resolved.clientId,
      scopes: resolved.scopes,
    }
  }

  const [row] = await db
    .select({
      keyId: apiKeys.id,
      keyName: apiKeys.name,
      creatorId: apiKeys.created_by,
      realmId: realms.id,
      realmSlug: realms.slug,
      realmName: realms.name,
      realmCreatedAt: realms.created_at,
      realmUpdatedAt: realms.updated_at,
    })
    .from(apiKeys)
    .innerJoin(
      realms,
      and(eq(realms.id, apiKeys.realm_id), isNull(realms.deleted_at)),
    )
    .where(and(eq(apiKeys.key_hash, hashKey(token)), isNull(apiKeys.revoked_at)))
    .limit(1)
  if (!row) {
    logger.warn('API key lookup failed (unknown or revoked key)')
    return null
  }

  const [membership] = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.realm_id, row.realmId),
        eq(members.actor_type, 'human'),
        eq(members.actor_id, row.creatorId),
        isNull(members.project_id),
        eq(members.status, 'active'),
      ),
    )
    .limit(1)
  if (!membership) {
    logger.warn('API key rejected: creator no longer an active realm member', {
      keyId: row.keyId,
    })
    return null
  }

  return {
    keyId: row.keyId,
    keyName: row.keyName,
    creatorId: row.creatorId,
    realm: {
      id: row.realmId,
      slug: row.realmSlug,
      name: row.realmName,
      created_at: row.realmCreatedAt,
      updated_at: row.realmUpdatedAt,
    },
    kind: 'api-key',
  }
}

/**
 * 鉴权成功后刷新 last_used_at（按主键的小更新；失败仅记录，不阻断请求）。
 * 双通道分别维护 api_keys / oauth_authorizations 的 last_used_at。
 */
export async function touchLastUsed(key: ResolvedApiKey): Promise<void> {
  try {
    const db = getDb()
    if (key.kind === 'oauth-token') {
      await db
        .update(oauthAuthorizations)
        .set({ last_used_at: new Date() })
        .where(eq(oauthAuthorizations.id, key.keyId))
      return
    }
    await db
      .update(apiKeys)
      .set({ last_used_at: new Date() })
      .where(eq(apiKeys.id, key.keyId))
  } catch (error) {
    logger.warn('Failed to update token last_used_at', { error })
  }
}

// ---- 公共前置（resonance 与 webhooks 服务层共用）----

export interface AuthorizedContext {
  key: ResolvedApiKey
}

/**
 * 公共前置：令牌解析（fail-closed）+ OAuth scope 按 method 强制。
 * 返回 Response 表示直接返回。不持有数据库句柄；与具体资源无关。
 * API Key 无 scope 概念（全放行）；OAuth token 缺所需 scope → 403。
 */
export async function authorizeRequest(
  request: Request,
): Promise<AuthorizedContext | Response> {
  const key = await resolveApiKey(request.headers.get('authorization'))
  if (key === null) return unauthorized()
  if (
    key.kind === 'oauth-token' &&
    !scopeAllowsMethod(key.scopes ?? [], request.method)
  ) {
    return apiError(
      403,
      'insufficient_scope',
      `OAuth token scope '${(key.scopes ?? []).join(' ')}' does not permit ${request.method} requests.`,
    )
  }
  await touchLastUsed(key)
  return { key }
}

/**
 * Realm 守卫：路径 realmId 必须等于令牌绑定 Realm，否则 404
 * （跨 Realm 一律 404，不泄露其他 Realm 的存在性）。
 */
export function requireRealmMatch(
  context: AuthorizedContext,
  realmId: string,
): Response | null {
  if (realmId !== context.key.realm.id) return notFound()
  return null
}

/** Gateway 服务主体：审计 actor 标识（沿 SCIM 惯例，与真实 Entity 区分）。 */
export function apiKeyActor(key: ResolvedApiKey) {
  const actorId =
    key.kind === 'oauth-token' && key.clientId
      ? `oauth-app:${key.clientId}`
      : `api-key:${key.keyId}`
  return { actorType: 'entity' as const, actorId }
}
