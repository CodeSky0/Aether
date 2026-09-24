// @aether/web · AI provider 配置 Server Actions（用户级 + Realm 级双层）
// API key 经 AES-GCM 加密入库（复用 @aether/resonance 加密工具 + AETHER_INTEGRATION_ENCRYPTION_KEY）；
// api_key_prefix 存明文前 8 字符供列表识别。明文 key 绝不返回客户端。
// is_default 至多一条：upsert 时主动清除同 scope 其他 default，partial unique 约束兜底。
'use server'

import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { realmAiConfigs, userAiConfigs } from '@aether/db'
import { encryptSecret, importAesKey } from '@aether/resonance'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { requireRealmRole } from '@/lib/membership-guard'
import { requireIntegrationEncryptionKey } from '@/lib/github'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

const providerSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'azure-openai',
  'custom',
])
const KEY_PREFIX_LENGTH = 8

async function encryptApiKey(
  plaintext: string,
): Promise<{ encrypted: string; prefix: string }> {
  const aesKey = await importAesKey(requireIntegrationEncryptionKey())
  const encrypted = await encryptSecret(plaintext, aesKey)
  return { encrypted, prefix: plaintext.slice(0, KEY_PREFIX_LENGTH) }
}

export type AiProvider = z.infer<typeof providerSchema>

export interface AiConfigRow {
  id: string
  provider: AiProvider
  label: string | null
  apiKeyPrefix: string
  model: string
  baseUrl: string | null
  isDefault: boolean
  createdAt: Date
}

function selectColumns(table: typeof userAiConfigs | typeof realmAiConfigs) {
  return {
    id: table.id,
    provider: table.provider,
    label: table.label,
    apiKeyPrefix: table.api_key_prefix,
    model: table.model,
    baseUrl: table.base_url,
    isDefault: table.is_default,
    createdAt: table.created_at,
  }
}

// ---- 用户级 ----

export async function listUserAiConfigs(): Promise<ActionResult<AiConfigRow[]>> {
  return runGuarded('listUserAiConfigs', async () => {
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    const db = getDb()
    return db
      .select(selectColumns(userAiConfigs))
      .from(userAiConfigs)
      .where(eq(userAiConfigs.user_id, actor.actorId))
      .orderBy(desc(userAiConfigs.created_at))
  })
}

const upsertUserAiConfigSchema = z.object({
  id: z.string().uuid().optional(),
  provider: providerSchema,
  label: z.string().trim().max(60).optional(),
  apiKey: z.string().min(1, 'API key 不能为空').optional(),
  model: z.string().trim().min(1, '模型不能为空'),
  baseUrl: z.string().trim().max(500).optional(),
  isDefault: z.boolean().default(false),
})

export async function upsertUserAiConfig(
  input: z.infer<typeof upsertUserAiConfigSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('upsertUserAiConfig', async () => {
    const parsed = upsertUserAiConfigSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    const db = getDb()
    const baseUrl = parsed.baseUrl || null

    if (parsed.isDefault) {
      await db
        .update(userAiConfigs)
        .set({ is_default: false })
        .where(eq(userAiConfigs.user_id, actor.actorId))
    }

    if (parsed.id) {
      const updates: Record<string, unknown> = {
        provider: parsed.provider,
        label: parsed.label ?? null,
        model: parsed.model,
        base_url: baseUrl,
        is_default: parsed.isDefault,
        updated_at: new Date(),
      }
      if (parsed.apiKey) {
        const { encrypted, prefix } = await encryptApiKey(parsed.apiKey)
        updates.api_key_encrypted = encrypted
        updates.api_key_prefix = prefix
      }
      const [updated] = await db
        .update(userAiConfigs)
        .set(updates)
        .where(
          and(
            eq(userAiConfigs.id, parsed.id),
            eq(userAiConfigs.user_id, actor.actorId),
          ),
        )
        .returning({ id: userAiConfigs.id })
      if (!updated) throw new Error('配置不存在')
      return updated
    }

    if (!parsed.apiKey) throw new Error('新建配置必须提供 API key')
    const { encrypted, prefix } = await encryptApiKey(parsed.apiKey)
    const [created] = await db
      .insert(userAiConfigs)
      .values({
        user_id: actor.actorId,
        provider: parsed.provider,
        label: parsed.label ?? null,
        api_key_encrypted: encrypted,
        api_key_prefix: prefix,
        model: parsed.model,
        base_url: baseUrl,
        is_default: parsed.isDefault,
      })
      .returning({ id: userAiConfigs.id })
    if (!created) throw new Error('创建配置失败')
    return created
  })
}

const deleteConfigSchema = z.object({ id: z.string().uuid() })

export async function deleteUserAiConfig(
  input: z.infer<typeof deleteConfigSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('deleteUserAiConfig', async () => {
    const parsed = deleteConfigSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    const db = getDb()
    const [deleted] = await db
      .delete(userAiConfigs)
      .where(
        and(
          eq(userAiConfigs.id, parsed.id),
          eq(userAiConfigs.user_id, actor.actorId),
        ),
      )
      .returning({ id: userAiConfigs.id })
    if (!deleted) throw new Error('配置不存在')
    return deleted
  })
}

// ---- Realm 级 ----

const realmScopeSchema = z.object({ realmId: realmIdField })

export async function listRealmAiConfigs(
  input: z.infer<typeof realmScopeSchema>,
): Promise<ActionResult<AiConfigRow[]>> {
  return runGuarded('listRealmAiConfigs', async () => {
    const parsed = realmScopeSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    return db
      .select(selectColumns(realmAiConfigs))
      .from(realmAiConfigs)
      .where(eq(realmAiConfigs.realm_id, parsed.realmId))
      .orderBy(desc(realmAiConfigs.created_at))
  })
}

const upsertRealmAiConfigSchema = upsertUserAiConfigSchema.extend({
  realmId: realmIdField,
})

export async function upsertRealmAiConfig(
  input: z.infer<typeof upsertRealmAiConfigSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('upsertRealmAiConfig', async () => {
    const parsed = upsertRealmAiConfigSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const baseUrl = parsed.baseUrl || null

    if (parsed.isDefault) {
      await db
        .update(realmAiConfigs)
        .set({ is_default: false })
        .where(eq(realmAiConfigs.realm_id, parsed.realmId))
    }

    if (parsed.id) {
      const updates: Record<string, unknown> = {
        provider: parsed.provider,
        label: parsed.label ?? null,
        model: parsed.model,
        base_url: baseUrl,
        is_default: parsed.isDefault,
        updated_at: new Date(),
      }
      if (parsed.apiKey) {
        const { encrypted, prefix } = await encryptApiKey(parsed.apiKey)
        updates.api_key_encrypted = encrypted
        updates.api_key_prefix = prefix
      }
      const [updated] = await db
        .update(realmAiConfigs)
        .set(updates)
        .where(
          and(
            eq(realmAiConfigs.id, parsed.id),
            eq(realmAiConfigs.realm_id, parsed.realmId),
          ),
        )
        .returning({ id: realmAiConfigs.id })
      if (!updated) throw new Error('配置不存在')
      return updated
    }

    if (!parsed.apiKey) throw new Error('新建配置必须提供 API key')
    const { encrypted, prefix } = await encryptApiKey(parsed.apiKey)
    const [created] = await db
      .insert(realmAiConfigs)
      .values({
        realm_id: parsed.realmId,
        provider: parsed.provider,
        label: parsed.label ?? null,
        api_key_encrypted: encrypted,
        api_key_prefix: prefix,
        model: parsed.model,
        base_url: baseUrl,
        is_default: parsed.isDefault,
        created_by: actor.actorId,
      })
      .returning({ id: realmAiConfigs.id })
    if (!created) throw new Error('创建配置失败')
    return created
  })
}

const deleteRealmAiConfigSchema = z.object({
  id: z.string().uuid(),
  realmId: realmIdField,
})

export async function deleteRealmAiConfig(
  input: z.infer<typeof deleteRealmAiConfigSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('deleteRealmAiConfig', async () => {
    const parsed = deleteRealmAiConfigSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const [deleted] = await db
      .delete(realmAiConfigs)
      .where(
        and(
          eq(realmAiConfigs.id, parsed.id),
          eq(realmAiConfigs.realm_id, parsed.realmId),
        ),
      )
      .returning({ id: realmAiConfigs.id })
    if (!deleted) throw new Error('配置不存在')
    return deleted
  })
}
