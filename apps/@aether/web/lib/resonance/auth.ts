// @aether/web · Resonance Gateway 鉴权层（/api/v1）
// 职责：Bearer 密钥解析 → api_keys 哈希查找 → Realm 存活 → 创建者 membership
// 三重 fail-closed 校验 → last_used_at 维护。
// 先哈希再走 key_hash 唯一索引查找，杜绝明文比对与时序侧信道。
import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'

import { apiKeys, members, realms } from '@aether/db'
import { getDb } from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { notFound, unauthorized } from './protocol'

const logger = createLogger('resonance:auth')

/** 密钥明文前缀（与 lib/api-keys.ts 的生成格式一致）。 */
const API_KEY_PREFIX = 'aeth_'

/** 解析 Authorization 头；非 Bearer / 非 aeth_ 前缀 / 空值返回 null。 */
export function parseBearerKey(
  authorization: string | null,
): string | null {
  if (!authorization) return null
  const scheme = authorization.slice(0, 7).toLowerCase()
  if (scheme !== 'bearer ') return null
  const token = authorization.slice(7)
  if (!token.startsWith(API_KEY_PREFIX) || token.length <= API_KEY_PREFIX.length) {
    return null
  }
  return token
}

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export interface ResolvedApiKey {
  keyId: string
  keyName: string
  /** 密钥创建者（Better-Auth user id）：dialogue 消息归因主体。 */
  creatorId: string
  realm: {
    id: string
    slug: string
    name: string
    created_at: Date
    updated_at: Date
  }
}

/**
 * 解析并校验 API Key（fail-closed）：
 *   1. api_keys 行存在且未吊销（revoked_at IS NULL）；
 *   2. 绑定 Realm 未软删除；
 *   3. 创建者仍是该 Realm 的 active human member（realm 级，project_id IS NULL）。
 * 任一不满足返回 null → 调用方统一 401（不区分失败原因，避免探测）。
 */
export async function resolveApiKey(
  authorization: string | null,
): Promise<ResolvedApiKey | null> {
  const token = parseBearerKey(authorization)
  if (token === null) return null
  const db = getDb()

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
  }
}

/** 鉴权成功后刷新 last_used_at（按主键的小更新；失败仅记录，不阻断请求）。 */
export async function touchLastUsed(keyId: string): Promise<void> {
  try {
    await getDb()
      .update(apiKeys)
      .set({ last_used_at: new Date() })
      .where(eq(apiKeys.id, keyId))
  } catch (error) {
    logger.warn('Failed to update api key last_used_at', { error })
  }
}

// ---- 公共前置（resonance 与 webhooks 服务层共用）----

export interface AuthorizedContext {
  key: ResolvedApiKey
}

/**
 * 公共前置：API Key 解析（fail-closed）。返回 Response 表示直接返回。
 * 不持有数据库句柄；与具体资源无关，可安全跨服务复用。
 */
export async function authorizeRequest(
  request: Request,
): Promise<AuthorizedContext | Response> {
  const key = await resolveApiKey(request.headers.get('authorization'))
  if (key === null) return unauthorized()
  await touchLastUsed(key.keyId)
  return { key }
}

/**
 * Realm 守卫：路径 realmId 必须等于密钥绑定 Realm，否则 404
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
  return { actorType: 'entity' as const, actorId: `api-key:${key.keyId}` }
}
