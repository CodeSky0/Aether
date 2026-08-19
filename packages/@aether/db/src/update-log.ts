// @aether/db · CRDT 更新日志查询层
// crdt_updates 是 Current 增量落库的追加式日志：Server Actions 状态通道
// 与 Hocuspocus 持久化共同依赖它做“落库 + 增量重放”。写入以
// (doc_ref, idempotency_key) 幂等去重，重放以 (realm, doc_ref, seq) 游标
// 顺序读取。所有访问强制携带 Realm 隔离守卫。
import { asc, eq, gt, max } from 'drizzle-orm'
import { crdtUpdates } from './schema.js'
import { realmScope } from './guards.js'
import type { ActorType } from '@aether/types'

export interface CrdtUpdateInput {
  docRef: string
  actorType: ActorType
  actorId: string
  /** Yjs 增量（encodeStateAsUpdate / applyDocUpdate 载荷） */
  payload: Uint8Array
  /** 幂等键：同一 (docRef, idempotencyKey) 只落库一次 */
  idempotencyKey: string
}

export type CrdtUpdateRecord = typeof crdtUpdates.$inferSelect

export interface CrdtReplayCursor {
  /** 只读取 seq 大于 afterSeq 的增量；缺省从 0 开始 */
  afterSeq?: number
  /** 单次重放上限，防止单次 Server Action 拉取全量 */
  limit?: number
}

// The database connection may be instantiated by another workspace package,
// which can carry a distinct Drizzle type identity in a monorepo build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UpdateLogDb = any

/**
 * 追加一条 CRDT 增量并落库。
 * 命中 (doc_ref, idempotency_key) 唯一约束时静默去重，返回 null。
 * 返回的记录携带服务端分配的单调 seq，作为后续重放游标。
 */
export async function appendCrdtUpdate(
  db: UpdateLogDb,
  realmId: string,
  input: CrdtUpdateInput,
): Promise<CrdtUpdateRecord | null> {
  const [record] = await db
    .insert(crdtUpdates)
    .values({
      realm_id: realmId,
      doc_ref: input.docRef,
      payload: input.payload,
      actor_type: input.actorType,
      actor_id: input.actorId,
      idempotency_key: input.idempotencyKey,
    })
    .onConflictDoNothing({
      target: [crdtUpdates.doc_ref, crdtUpdates.idempotency_key],
    })
    .returning()
  return record ?? null
}

/**
 * 按 Realm 隔离的游标读取 doc 的增量日志（seq 升序）。
 * 用于 Reconnect Handshake 增量对账与 Server Actions 落库后的重放。
 */
export async function readCrdtUpdatesSince(
  db: UpdateLogDb,
  realmId: string,
  docRef: string,
  cursor: CrdtReplayCursor = {},
): Promise<CrdtUpdateRecord[]> {
  const afterSeq = cursor.afterSeq ?? 0
  const scope = realmScope(
    crdtUpdates,
    realmId,
    eq(crdtUpdates.doc_ref, docRef),
    gt(crdtUpdates.seq, afterSeq),
  )
  const query = db
    .select()
    .from(crdtUpdates)
    .where(scope)
    .orderBy(asc(crdtUpdates.seq))
  const limited = cursor.limit === undefined ? query : query.limit(cursor.limit)
  return limited
}

/**
 * 读取 doc 当前已落库的最大 seq，用于初始化重放游标。
 * 从未写入过任何增量时返回 null。
 */
export async function readCrdtUpdateCursor(
  db: UpdateLogDb,
  realmId: string,
  docRef: string,
): Promise<number | null> {
  const [row] = await db
    .select({ maxSeq: max(crdtUpdates.seq) })
    .from(crdtUpdates)
    .where(realmScope(crdtUpdates, realmId, eq(crdtUpdates.doc_ref, docRef)))
  return row?.maxSeq ?? null
}
