// @aether/web · Current 状态通道 Server Actions
// 客户端 CRDT 更新经此落库，服务端广播回其他客户端。
// 序列化统一走 @aether/current-sync 的 serializeUpdate/deserializeUpdate。
// 这是探测文档定义的「非权威通道」——Hocuspocus 接入后承担权威 WebSocket 收敛。
// Production 约定：入参过 zod 校验，返回 ActionResult。
'use server'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { getBroadcastPort } from '@/lib/current/broadcast'
import {
  requireEntitlement,
  requireRealmAccess,
  resolveCurrentActor,
} from '@/lib/auth-guard'
import {
  appendUpdate,
  getCursor,
  replayUpdates,
  type AppendUpdateResult,
  type ReplayResult,
} from '@/lib/current/channel-service'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'
export type { AppendUpdateResult, ReplayResult }

const docRefField = z.string().min(1, 'docRef 不能为空').max(200, 'docRef 过长')
const serializedPayloadField = z
  .string()
  .min(1, 'serializedPayload 不能为空')
  .max(4_000_000, 'payload 过大')

export interface AppendCurrentUpdateInput {
  realmId: string
  docRef: string
  serializedPayload: string
  idempotencyKey: string
}

const appendCurrentUpdateInputSchema = z.object({
  realmId: realmIdField,
  docRef: docRefField,
  serializedPayload: serializedPayloadField,
  idempotencyKey: z.string().min(1, 'idempotencyKey 不能为空').max(200),
})

/**
 * 追加一条 CRDT 增量并落库 + 广播。
 * 幂等：同一 (docRef, idempotencyKey) 只落库一次。
 */
export async function appendCurrentUpdate(
  input: AppendCurrentUpdateInput,
): Promise<ActionResult<AppendUpdateResult>> {
  return runGuarded('appendCurrentUpdate', async () => {
    const parsed = appendCurrentUpdateInputSchema.parse(input)
    // P2-18 修复：鉴权守卫 —— 防止向任意 doc 写入
    await requireEntitlement(parsed.realmId, {
      resource: 'current',
      action: 'converge',
      resourceId: parsed.docRef,
    })
    const actor = (await resolveCurrentActor()) ?? {
      actorType: 'human' as const,
      actorId: 'web-client',
    }
    const db = getDb()
    const broadcast = getBroadcastPort()
    return appendUpdate(db, broadcast, { ...parsed, ...actor })
  })
}

const replayCurrentUpdatesSchema = z.object({
  realmId: realmIdField,
  docRef: docRefField,
  afterSeq: z.number().int().min(0).nullable(),
  limit: z.number().int().min(1, 'limit 至少为 1').max(500, 'limit 最大 500').optional(),
})

/**
 * 游标重放：读取 doc 指定 seq 之后的增量。
 * 客户端用 nextCursor 作为下次轮询的 afterSeq。
 */
export async function replayCurrentUpdates(
  realmId: string,
  docRef: string,
  afterSeq: number | null,
  limit?: number,
): Promise<ActionResult<ReplayResult>> {
  return runGuarded('replayCurrentUpdates', async () => {
    const parsed = replayCurrentUpdatesSchema.parse({
      realmId,
      docRef,
      afterSeq,
      limit,
    })
    // P2-18 修复：鉴权守卫
    await requireRealmAccess(parsed.realmId)
    const db = getDb()
    return replayUpdates(db, parsed.realmId, parsed.docRef, parsed.afterSeq, parsed.limit)
  })
}

const getCurrentCursorSchema = z.object({
  realmId: realmIdField,
  docRef: docRefField,
})

/**
 * 读取 doc 当前最大 seq，用于客户端初始化重放游标。
 */
export async function getCurrentCursor(
  realmId: string,
  docRef: string,
): Promise<ActionResult<{ cursor: number | null }>> {
  return runGuarded('getCurrentCursor', async () => {
    const parsed = getCurrentCursorSchema.parse({ realmId, docRef })
    // P2-18 修复：鉴权守卫
    await requireRealmAccess(parsed.realmId)
    const db = getDb()
    return getCursor(db, parsed.realmId, parsed.docRef)
  })
}
