// @aether/web · SCIM 2.0 provisioning 业务层
// 职责：Bearer 鉴权 → Realm/org 解析 → 五个 handler 的领域逻辑。
// 路由层只透传参数；协议结构（错误体 / 资源映射 / 分页）在 protocol.ts。
import { timingSafeEqual } from 'node:crypto'
import type { AuthInstance } from '@aether/auth'
import {
  createAuthUser,
  deleteOrganizationMember,
  findAuthUserByEmail,
  findAuthUserById,
  findOrganizationMemberRoles,
  isPlaceholderOrganization,
  listOrganizationMembers,
  provisionOrganizationMember,
  updateAuthUserName,
} from '@aether/auth'
import { members, realms } from '@aether/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tryGetAuth } from '@/lib/auth'
import { recordPermissionChange } from '@/lib/audit-write'
import { createLogger } from '@/lib/logger'
import { resolveScimConfig, type ScimConfig } from './config'
import {
  extractPatchChanges,
  parseScimFilter,
  parseScimPagination,
  scimError,
  scimJson,
  toListResponse,
  toScimUserResource,
} from './protocol'

const logger = createLogger('scim')

/** SCIM 服务主体：审计中的 actor 标识（与真实 Entity 区分的规范约定）。 */
const SCIM_ACTOR = { actorType: 'entity', actorId: 'scim' } as const
const SCIM_PROVISION_ROLE = 'member'

export function scimNotEnabled(): Response {
  // 未配置 SCIM 时一律 404，不向探测方泄露部署形态。
  return new Response(null, { status: 404 })
}

/** constant-time Bearer token 校验。 */
function bearerMatchesToken(
  authorization: string | null,
  token: string,
): boolean {
  if (!authorization) return false
  const scheme = authorization.slice(0, 7).toLowerCase()
  if (scheme !== 'bearer ') return false
  const provided = authorization.slice(7)
  if (provided.length !== token.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(token))
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Invalid or missing bearer token',
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/scim+json',
        'www-authenticate': 'Bearer',
      },
    },
  )
}

interface AuthorizedContext {
  config: ScimConfig
  auth: AuthInstance
  authOrgId: string
}

/**
 * 公共前置：配置解析（残缺 → 500 可读错误）、Bearer 鉴权、Better-Auth 实例。
 * requireRealm 时再解析 Realm → organization 绑定。
 * 返回 Response 表示应直接返回该响应。
 */
async function authorize(
  request: Request,
  options?: { requireRealm: boolean },
): Promise<AuthorizedContext | Response> {
  let config: ScimConfig | null
  try {
    config = resolveScimConfig(process.env)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logger.error('SCIM configuration invalid', { detail })
    return scimError(500, detail)
  }
  if (!config) return scimNotEnabled()

  if (
    !bearerMatchesToken(request.headers.get('authorization'), config.token)
  ) {
    return unauthorized()
  }

  const auth = tryGetAuth()
  if (!auth) {
    return scimError(
      500,
      'SCIM requires Better-Auth to be configured (BETTER_AUTH_URL / BETTER_AUTH_SECRET).',
    )
  }
  if (!options?.requireRealm) return { config, auth, authOrgId: '' }

  const [realm] = await getDb()
    .select({ authOrgId: realms.auth_org_id })
    .from(realms)
    .where(eq(realms.id, config.realmId))
    .limit(1)
  if (!realm) {
    return scimError(
      500,
      `AETHER_SCIM_REALM_ID references a realm that does not exist: ${config.realmId}`,
    )
  }
  if (isPlaceholderOrganization(realm.authOrgId)) {
    return scimError(
      500,
      'Realm is not bound to a Better-Auth organization; rebuild or bind the Realm before enabling SCIM.',
    )
  }
  return { config, auth, authOrgId: realm.authOrgId }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response
}

function requestOrigin(request: Request): string {
  return new URL(request.url).origin
}

function baseUrl(): string {
  return process.env.BETTER_AUTH_URL?.replace(/\/$/, '') ?? ''
}

// ---- GET /ServiceProviderConfig ----

export async function handleServiceProviderConfig(
  request: Request,
): Promise<Response> {
  const context = await authorize(request)
  if (isResponse(context)) return context

  return scimJson({
    schemas: [
      'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
    ],
    patch: { supported: true },
    filter: { supported: true, maxResults: 200 },
    sort: { supported: false },
    etag: { supported: false },
    changePassword: { supported: false },
    listEndpoint: `${baseUrl()}/api/scim/v2/Users`,
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description:
          'Authorization header with a bearer token provisioned via AETHER_SCIM_TOKEN.',
        primary: true,
      },
    ],
  })
}

// ---- GET /Users ----

export async function handleListUsers(request: Request): Promise<Response> {
  const context = await authorize(request, { requireRealm: true })
  if (isResponse(context)) return context

  const url = new URL(request.url)
  const filter = parseScimFilter(url.searchParams.get('filter'))
  if (filter?.kind === 'unsupported') {
    return scimError(
      400,
      'Unsupported SCIM filter; only a single "userName eq" filter is supported.',
    )
  }
  const { startIndex, count } = parseScimPagination(url.searchParams)

  const rows = await listOrganizationMembers(getDb(), {
    organizationId: context.authOrgId,
  })
  const filtered =
    filter?.kind === 'userName'
      ? rows.filter((row) => row.email.toLowerCase() === filter.value)
      : rows
  const page = filtered.slice(startIndex - 1, startIndex - 1 + count)

  return scimJson(
    toListResponse({
      totalResults: filtered.length,
      startIndex,
      itemsPerPage: count,
      resources: page.map((row) =>
        toScimUserResource(
          {
            id: row.userId,
            name: row.name,
            email: row.email,
            createdAt: row.createdAt,
            active: true,
          },
          requestOrigin(request),
        ),
      ),
    }),
  )
}

// ---- POST /Users ----

function parseCreateUserInput(
  body: unknown,
): { userName: string; displayName: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const userName = (body as { userName?: unknown }).userName
  const displayName = (body as { displayName?: unknown }).displayName
  if (typeof userName !== 'string') return null
  const email = userName.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  const localPart = email.split('@')[0] ?? email
  const name =
    typeof displayName === 'string' && displayName.trim().length > 0
      ? displayName.trim()
      : localPart
  return { userName: email, displayName: name }
}

export async function handleCreateUser(request: Request): Promise<Response> {
  const context = await authorize(request, { requireRealm: true })
  if (isResponse(context)) return context
  const { auth, authOrgId, config } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return scimError(400, 'Request body must be valid JSON.')
  }
  const input = parseCreateUserInput(body)
  if (!input) {
    return scimError(400, 'A valid userName (email address) is required.')
  }

  const existing = await findAuthUserByEmail(getDb(), input.userName)
  if (existing) {
    return scimError(409, 'A user with this userName already exists.')
  }

  const user = await createAuthUser(getDb(), {
    name: input.displayName,
    email: input.userName,
  })
  await provisionOrganizationMember(auth, {
    organizationId: authOrgId,
    userId: user.id,
    role: SCIM_PROVISION_ROLE,
  })
  await grantRealmMembership(config.realmId, user.id)

  return scimJson(
    toScimUserResource(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        active: true,
      },
      requestOrigin(request),
    ),
    201,
  )
}

/** 事务内：补 Aether membership + 审计（幂等）。 */
async function grantRealmMembership(
  realmId: string,
  userId: string,
): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(members)
      .values({
        realm_id: realmId,
        project_id: null,
        actor_type: 'human',
        actor_id: userId,
        role: SCIM_PROVISION_ROLE,
        entitlements: {},
        status: 'active',
      })
      .onConflictDoNothing()
      .returning({ id: members.id })
    if (inserted.length === 0) return
    await recordPermissionChange(tx, {
      realmId,
      actor: SCIM_ACTOR,
      target: {
        kind: 'realm_membership',
        role: SCIM_PROVISION_ROLE,
        actor_id: userId,
        source: 'scim',
      },
      idempotencyKey: `scim:provision:${realmId}:${userId}`,
      result: { status: 'active' },
    })
  })
}

/** 事务内：删 Aether membership + 审计（幂等）。 */
async function revokeRealmMembership(
  realmId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(members)
      .where(
        and(
          eq(members.realm_id, realmId),
          eq(members.actor_type, 'human'),
          eq(members.actor_id, userId),
          isNull(members.project_id),
        ),
      )
      .returning({ id: members.id })
    if (deleted.length === 0) return false
    await recordPermissionChange(tx, {
      realmId,
      actor: SCIM_ACTOR,
      target: {
        kind: 'realm_membership',
        actor_id: userId,
        source: 'scim',
      },
      idempotencyKey: `scim:deprovision:${realmId}:${userId}`,
      result: { status: 'revoked' },
    })
    return true
  })
}

// ---- GET /Users/{id} ----

export async function handleGetUser(
  request: Request,
  userId: string,
): Promise<Response> {
  const context = await authorize(request, { requireRealm: true })
  if (isResponse(context)) return context

  const user = await findAuthUserById(getDb(), userId)
  if (!user) return scimError(404, 'User not found.')
  const roles = await findOrganizationMemberRoles(getDb(), {
    organizationId: context.authOrgId,
    userId: user.id,
  })
  if (roles.length === 0) return scimError(404, 'User not found.')

  return scimJson(
    toScimUserResource(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        active: true,
      },
      requestOrigin(request),
    ),
  )
}

// ---- PATCH /Users/{id} ----

export async function handlePatchUser(
  request: Request,
  userId: string,
): Promise<Response> {
  const context = await authorize(request, { requireRealm: true })
  if (isResponse(context)) return context
  const { auth, authOrgId, config } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return scimError(400, 'Request body must be valid JSON.')
  }
  const changes = extractPatchChanges(body)
  if (changes === null) {
    return scimError(
      400,
      'Unsupported PATCH operation; only replace of active / displayName is supported.',
    )
  }

  const user = await findAuthUserById(getDb(), userId)
  if (!user) return scimError(404, 'User not found.')

  let displayName = user.name
  if (changes.displayName !== undefined) {
    displayName = changes.displayName
    await updateAuthUserName(getDb(), userId, displayName)
  }

  if (changes.active !== undefined) {
    if (changes.active) {
      await activateUser(auth, authOrgId, config.realmId, user.id)
    } else {
      await deprovisionUser(authOrgId, config.realmId, user.id)
    }
  }

  return scimJson(
    toScimUserResource(
      {
        id: user.id,
        name: displayName,
        email: user.email,
        createdAt: user.createdAt,
        active: changes.active ?? true,
      },
      requestOrigin(request),
    ),
  )
}

/** 启用：member 行缺失时补（system action），再确保 Aether membership。幂等。 */
async function activateUser(
  auth: AuthInstance,
  authOrgId: string,
  realmId: string,
  userId: string,
): Promise<void> {
  const roles = await findOrganizationMemberRoles(getDb(), {
    organizationId: authOrgId,
    userId,
  })
  if (roles.length === 0) {
    await provisionOrganizationMember(auth, {
      organizationId: authOrgId,
      userId,
      role: SCIM_PROVISION_ROLE,
    })
  }
  await grantRealmMembership(realmId, userId)
}

// ---- DELETE /Users/{id} ----

export async function handleDeleteUser(
  request: Request,
  userId: string,
): Promise<Response> {
  const context = await authorize(request, { requireRealm: true })
  if (isResponse(context)) return context

  const user = await findAuthUserById(getDb(), userId)
  if (!user) return scimError(404, 'User not found.')

  await deprovisionUser(context.authOrgId, context.config.realmId, user.id)
  return new Response(null, { status: 204 })
}

/** 回收：删 organization member 行 + 删 Aether membership；幂等。 */
async function deprovisionUser(
  authOrgId: string,
  realmId: string,
  userId: string,
): Promise<boolean> {
  const orgDeleted = await deleteOrganizationMember(getDb(), {
    organizationId: authOrgId,
    userId,
  })
  const membershipDeleted = await revokeRealmMembership(realmId, userId)
  return orgDeleted || membershipDeleted
}
