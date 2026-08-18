// @aether/web · 内部审计写入辅助函数
import { createHash } from 'node:crypto'
import { auditLog } from '@aether/db'
import type { ActorType } from '@aether/types'
import type { getDb } from '@/lib/db'

type AuditTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>['transaction']>[0]
>[0]

type Database = ReturnType<typeof getDb>

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
