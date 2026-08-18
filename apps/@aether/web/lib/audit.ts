// @aether/web · Audit 记录 Server Actions
'use server'
import { getDb } from '@/lib/db'
import { auditLog } from '@aether/db'
import { and, desc, eq } from 'drizzle-orm'
import type { ActorType, AuditAction } from '@aether/types'
import { requireEntitlement } from '@/lib/auth-guard'
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
export async function listAuditLogs(input: ListAuditLogsInput): Promise<AuditRow[]> {
  // P2-18 修复：鉴权守卫 —— 校验 realmId 格式与 Realm 存在性
  await requireEntitlement(input.realmId, {
    resource: 'audit',
    action: 'read',
  })
  const db = getDb()
  const limit = input.limit ?? 100
  const offset = input.offset ?? 0
  const conditions = [eq(auditLog.realm_id, input.realmId)]
  if (input.actorType) conditions.push(eq(auditLog.actor_type, input.actorType))
  if (input.action) conditions.push(eq(auditLog.action, input.action))
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
}
