// @aether/web · API Keys Server Actions（Resonance 预备）
// 规则：明文密钥仅生成响应返回一次；库内只存 sha256 哈希 + 展示前缀。
// 授权：owner/admin 可生成与吊销（membership 守卫，不受功能开关影响）。
'use server'

import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { apiKeys } from '@aether/db'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { requireRealmRole } from '@/lib/membership-guard'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

export interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  created_at: Date
  last_used_at: Date | null
}

export interface GeneratedApiKey extends ApiKeyRow {
  /** 明文密钥：仅此一次返回，刷新后不可再现 */
  plaintext: string
}

/** 密钥明文格式：aeth_<32 字节 base64url> */
function generateKeyPlaintext(): string {
  return `aeth_${randomBytes(32).toString('base64url')}`
}

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

const realmScopedSchema = z.object({ realmId: realmIdField })

const generateApiKeyInputSchema = z.object({
  realmId: realmIdField,
  name: z.string().trim().min(1, '密钥名称不能为空').max(60, '名称最长 60 字符'),
})

/** 列出 Realm 的有效密钥（revoked_at IS NULL），按创建时间降序。 */
export async function listApiKeys(
  input: z.infer<typeof realmScopedSchema>,
): Promise<ActionResult<ApiKeyRow[]>> {
  return runGuarded('listApiKeys', async () => {
    const parsed = realmScopedSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Listing API keys requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    return getDb()
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        key_prefix: apiKeys.key_prefix,
        created_at: apiKeys.created_at,
        last_used_at: apiKeys.last_used_at,
      })
      .from(apiKeys)
      .where(
        and(eq(apiKeys.realm_id, parsed.realmId), isNull(apiKeys.revoked_at)),
      )
      .orderBy(desc(apiKeys.created_at))
  })
}

/** 生成新密钥：明文仅本次返回；哈希 + 前 12 字符入库。 */
export async function generateApiKey(
  input: z.infer<typeof generateApiKeyInputSchema>,
): Promise<ActionResult<GeneratedApiKey>> {
  return runGuarded('generateApiKey', async () => {
    const parsed = generateApiKeyInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Generating an API key requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])

    const plaintext = generateKeyPlaintext()
    const [created] = await getDb()
      .insert(apiKeys)
      .values({
        realm_id: parsed.realmId,
        name: parsed.name,
        key_prefix: plaintext.slice(0, 12),
        key_hash: hashKey(plaintext),
        created_by: actor.actorId,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        key_prefix: apiKeys.key_prefix,
        created_at: apiKeys.created_at,
        last_used_at: apiKeys.last_used_at,
      })
    if (!created) throw new Error('Failed to create API key')
    return { ...created, plaintext }
  })
}

const revokeApiKeyInputSchema = z.object({
  realmId: realmIdField,
  keyId: z.string().uuid('keyId 必须是 UUID'),
})

/** 吊销密钥（软删除）：revoked_at 置当前时间，审计线索保留。 */
export async function revokeApiKey(
  input: z.infer<typeof revokeApiKeyInputSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('revokeApiKey', async () => {
    const parsed = revokeApiKeyInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Revoking an API key requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])

    const [revoked] = await getDb()
      .update(apiKeys)
      .set({ revoked_at: new Date() })
      .where(
        and(
          eq(apiKeys.id, parsed.keyId),
          eq(apiKeys.realm_id, parsed.realmId),
          isNull(apiKeys.revoked_at),
        ),
      )
      .returning({ id: apiKeys.id })
    if (!revoked) throw new Error('密钥不存在或已被吊销')
    return revoked
  })
}
