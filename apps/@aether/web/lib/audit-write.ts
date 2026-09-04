// @aether/web · 内部审计写入辅助函数
import { createHash } from 'node:crypto'
import { auditLog } from '@aether/db'
import type { ActorType } from '@aether/types'
import type { getDb } from '@/lib/db'

type AuditTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>['transaction']>[0]
>[0]

type Database = ReturnType<typeof getDb>

/** audit_log.action 的全枚举写入入参（含 write / converse 等通用动作）。 */
export interface RecordAuditEntryInput {
  realmId: string
  actor: {
    actorType: ActorType
    actorId: string
  }
  action: (typeof auditLog.$inferInsert)['action']
  target: Record<string, unknown>
  idempotencyKey: string
  result: Record<string, unknown>
}

/**
 * 通用审计写入：与业务变更同事务调用（Resonance Gateway 等无会话通道共用）。
 * 台账仅追加，幂等键由调用方保证稳定（重试不产生重复行由上游约束）。
 */
export async function recordAuditEntry(
  tx: AuditTransaction,
  input: RecordAuditEntryInput,
): Promise<void> {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(input.target), 'utf8')
    .digest('hex')

  await tx.insert(auditLog).values({
    realm_id: input.realmId,
    actor_type: input.actor.actorType,
    actor_id: input.actor.actorId,
    action: input.action,
    target: input.target,
    payload_hash: payloadHash,
    idempotency_key: input.idempotencyKey,
    result: input.result,
  })
}

interface RecordAuditExportInput {
  realmId: string
  actor: {
    actorType: ActorType
    actorId: string
  }
  target: Record<string, unknown>
  idempotencyKey: string
}

/** 导出本身也是一次审计读取，写入 `read` 记录，保证台账能回答「谁导出了什么」。 */
export async function recordAuditExport(
  db: Database,
  input: RecordAuditExportInput,
): Promise<void> {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(input.target), 'utf8')
    .digest('hex')

  await db.insert(auditLog).values({
    realm_id: input.realmId,
    actor_type: input.actor.actorType,
    actor_id: input.actor.actorId,
    action: 'read',
    target: input.target,
    payload_hash: payloadHash,
    idempotency_key: input.idempotencyKey,
    result: {},
  })
}

interface RecordPermissionChangeInput {
  realmId: string
  actor: {
    actorType: ActorType
    actorId: string
  }
  target: Record<string, unknown>
  idempotencyKey: string
  result: Record<string, unknown>
}

export async function recordPermissionChange(
  tx: AuditTransaction,
  input: RecordPermissionChangeInput,
): Promise<void> {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(input.target), 'utf8')
    .digest('hex')

  await tx.insert(auditLog).values({
    realm_id: input.realmId,
    actor_type: input.actor.actorType,
    actor_id: input.actor.actorId,
    action: 'permission_change',
    target: input.target,
    payload_hash: payloadHash,
    idempotency_key: input.idempotencyKey,
    result: input.result,
  })
}
