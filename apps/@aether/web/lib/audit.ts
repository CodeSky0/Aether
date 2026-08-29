// @aether/web · Audit 记录 Server Actions
// Production 约定：入参过 zod 校验，返回 ActionResult。
'use server'
import { getDb } from '@/lib/db'
import { auditLog } from '@aether/db'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ActorType, AuditAction } from '@aether/types'
import { requireEntitlement } from '@/lib/auth-guard'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

export interface AuditRow {
  id: string
  // P2-12 修复：realm_id 是 map 返回的实际字段，补进接口避免契约外字段漂移
  realm_id: string
  actor_type: ActorType
  actor_id: string
  action: AuditAction
  doc_ref?: string
  entity_id?: string
  payload_hash: string
  created_at: Date
}
export interface ListAuditLogsInput {
  realmId: string
  /** 默认按 created_at 降序，最多返回 100 条 */
  limit?: number
  /** 偏移量，用于"加载更多"分页（P1-7 修复：客户端按 offset 翻页） */
  offset?: number
  actorType?: ActorType
  action?: AuditAction
}

const listAuditLogsInputSchema = z.object({
  realmId: realmIdField,
  limit: z.number().int().min(1, 'limit 至少为 1').max(500, 'limit 最大 500').optional(),
  offset: z.number().int().min(0, 'offset 不能为负').optional(),
  actorType: z.enum(['human', 'entity']).optional(),
  action: z
    .enum(['read', 'write', 'permission_change', 'converse', 'execute'])
    .optional(),
})

export async function listAuditLogs(
  input: ListAuditLogsInput,
): Promise<ActionResult<AuditRow[]>> {
  return runGuarded('listAuditLogs', async () => {
    const parsed = listAuditLogsInputSchema.parse(input)
    // P2-18 修复：鉴权守卫 —— 校验 realmId 格式与 Realm 存在性
    await requireEntitlement(parsed.realmId, {
      resource: 'audit',
      action: 'read',
    })
    const db = getDb()
    const limit = parsed.limit ?? 100
    const offset = parsed.offset ?? 0
    const conditions = [eq(auditLog.realm_id, parsed.realmId)]
    if (parsed.actorType) conditions.push(eq(auditLog.actor_type, parsed.actorType))
    if (parsed.action) conditions.push(eq(auditLog.action, parsed.action))
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.created_at))
      .limit(limit)
      .offset(offset)
    return rows
      .map((r) => {
        const target = r.target as Record<string, unknown>
        const docRef = target.doc_ref as string | undefined
        const entityId = target.entity_id as string | undefined
        return {
          id: r.id,
          realm_id: r.realm_id,
          actor_type: r.actor_type,
          actor_id: r.actor_id,
          action: r.action,
          payload_hash: r.payload_hash,
          created_at: r.created_at,
          ...(docRef !== undefined ? { doc_ref: docRef } : {}),
          ...(entityId !== undefined ? { entity_id: entityId } : {}),
        }
      })
  })
}
