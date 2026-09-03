// @aether/web · Current 状态通道闭环测试
// 使用 drizzle-orm/pg-proxy 捕获 SQL，无需真实数据库即可验证
// appendUpdate → replayUpdates → getCursor 的完整往返。
// 与 @aether/db/tests/update-log.test.ts 同构。
import { describe, it, expect } from 'vitest'
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy'
import {
  appendUpdate,
  getCursor,
  replayUpdates,
  DEFAULT_REPLAY_LIMIT,
} from '@/lib/current/channel-service'
import {
  InMemoryBroadcastPort,
  type BroadcastEvent,
} from '@/lib/current/broadcast'
import { serializeUpdate, deserializeUpdate } from '@aether/current-sync'
import type { UpdateLogDb } from '@aether/db'
import * as Y from 'yjs'

const CRDT_COLUMN_ORDER = [
  'id',
  'realm_id',
  'doc_ref',
  'seq',
  'payload',
  'actor_type',
  'actor_id',
  'idempotency_key',
  'created_at',
] as const

const TEST_REALM = '550e8400-e29b-41d4-a716-446655440000'
const TEST_DOC = 'doc:realm-a:current-1'

interface CapturedQuery {
  sql: string
  params: unknown[]
  method: 'all' | 'execute'
}

interface MockStore {
  rows: Record<string, unknown>[]
  nextSeq: number
}

function toArrayRow(record: Record<string, unknown>): unknown[] {
  return CRDT_COLUMN_ORDER.map((key) => record[key])
}

/**
 * 创建 pg-proxy mock db，模拟 crdt_updates 的插入与查询。
 * insert returning 返回新行；select 返回匹配行。
 */
function createMockDb(initialRows: Record<string, unknown>[] = []) {
  const store: MockStore = {
    rows: [...initialRows],
    nextSeq: initialRows.length > 0
      ? Math.max(...initialRows.map((r) => r.seq as number)) + 1
      : 1,
  }
  const queries: CapturedQuery[] = []

  const callback: RemoteCallback = async (sql, params, method) => {
    await Promise.resolve()
    const query = { sql, params, method }
    queries.push(query)

    // insert into crdt_updates ... on conflict do nothing returning *
    if (sql.includes('insert into "crdt_updates"')) {
      // drizzle INSERT 参数顺序: [realm_id, doc_ref, payload, actor_type, actor_id, idempotency_key]
      const idempotencyKey = params[5] as string
      const existing = store.rows.find(
        (r) => r.idempotency_key === idempotencyKey && r.doc_ref === params[1],
      )
      if (existing) {
        // on conflict do nothing → returning 空
        return { rows: [] }
      }
      const newRow = {
        id: `id-${store.nextSeq}`,
        realm_id: params[0] as string,
        doc_ref: params[1] as string,
        seq: store.nextSeq,
        payload: params[2] as Uint8Array,
        actor_type: params[3] as string,
        actor_id: params[4] as string,
        idempotency_key: idempotencyKey,
        created_at: new Date(),
      }
      store.rows.push(newRow)
      store.nextSeq += 1
      return { rows: [toArrayRow(newRow)] }
    }

    // select ... from crdt_updates where ... order by seq asc [limit N]
    if (sql.includes('from "crdt_updates"')) {
      if (sql.includes('max("seq")')) {
        const docRef = params[params.length - 1] as string
        const matching = store.rows.filter((r) => r.doc_ref === docRef)
        if (matching.length === 0) {
          return { rows: [] }
        }
        const maxSeq = Math.max(...matching.map((r) => r.seq as number))
        return { rows: [[maxSeq]] }
      }

      // readCrdtUpdatesSince: params = [realmId, docRef, afterSeq] (+ limit)
      const realmId = params[0] as string
      const docRef = params[1] as string
      const afterSeq = params[2] as number
      let matching = store.rows
        .filter(
          (r) =>
            r.realm_id === realmId &&
            r.doc_ref === docRef &&
            (r.seq as number) > afterSeq,
        )
        .sort((a, b) => (a.seq as number) - (b.seq as number))

      // limit（readCrdtUpdatesSince 传 limit+1 用于 hasMore 判断）
      const limitMatch = sql.match(/limit (\d+)/)
      if (limitMatch) {
        const limit = parseInt(limitMatch[1]!, 10)
        matching = matching.slice(0, limit)
      }

      return { rows: matching.map(toArrayRow) }
    }

    return { rows: [] }
  }

  // pg-proxy 无 schema 的实例（PgRemoteDatabase）与 UpdateLogDb 的 query 属性
  // 类型不兼容；测试只走 insert/select，收窄到目标类型即可。
  const db = drizzle(callback) as unknown as UpdateLogDb
  return { db, store, queries }
}

/** 生成一条 Yjs update 字节并序列化 */
function makeSerializedUpdate(text: string): string {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  const update = Y.encodeStateAsUpdate(doc)
  return serializeUpdate(update)
}

describe('appendUpdate', () => {
  it('反序列化 payload 并落库，返回服务端 seq', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()
    const serialized = makeSerializedUpdate('hello')

    const result = await appendUpdate(db, broadcast, {
      realmId: TEST_REALM,
      docRef: TEST_DOC,
      serializedPayload: serialized,
      actorType: 'human',
      actorId: '4e0f9c1a-0000-0000-0000-000000000001',
      idempotencyKey: 'op-0001',
    })

    expect(result.seq).toBe(1)
    expect(result.deduplicated).toBe(false)
  })

  it('幂等去重：同一 idempotencyKey 返回 deduplicated=true', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()
    const serialized = makeSerializedUpdate('hello')

    const first = await appendUpdate(db, broadcast, {
      realmId: TEST_REALM,
      docRef: TEST_DOC,
      serializedPayload: serialized,
      actorType: 'human',
      actorId: '4e0f9c1a-0000-0000-0000-000000000001',
      idempotencyKey: 'op-dup',
    })
    const second = await appendUpdate(db, broadcast, {
      realmId: TEST_REALM,
      docRef: TEST_DOC,
      serializedPayload: serialized,
      actorType: 'human',
      actorId: '4e0f9c1a-0000-0000-0000-000000000001',
      idempotencyKey: 'op-dup',
    })

    expect(first.seq).toBe(1)
    expect(first.deduplicated).toBe(false)
    expect(second.seq).toBeNull()
    expect(second.deduplicated).toBe(true)
  })

  it('落库后经广播端口发布事件', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()
    const events: BroadcastEvent[] = []
    broadcast.subscribe(TEST_REALM, TEST_DOC, (e) => events.push(e))
    const serialized = makeSerializedUpdate('broadcast-test')

    await appendUpdate(db, broadcast, {
      realmId: TEST_REALM,
      docRef: TEST_DOC,
      serializedPayload: serialized,
      actorType: 'entity',
      actorId: '4e0f9c1a-0000-0000-0000-000000000002',
      idempotencyKey: 'op-bc',
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.seq).toBe(1)
    expect(events[0]!.actorType).toBe('entity')
    expect(events[0]!.actorId).toBe('4e0f9c1a-0000-0000-0000-000000000002')
    expect(events[0]!.serializedPayload).toBe(serialized)
  })

  it('广播不泄漏到其他 doc', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()
    const otherEvents: BroadcastEvent[] = []
    broadcast.subscribe(TEST_REALM, 'doc:other', (e) => otherEvents.push(e))

    await appendUpdate(db, broadcast, {
      realmId: TEST_REALM,
      docRef: TEST_DOC,
      serializedPayload: makeSerializedUpdate('isolated'),
      actorType: 'human',
      actorId: '4e0f9c1a-0000-0000-0000-000000000001',
      idempotencyKey: 'op-iso',
    })

    expect(otherEvents).toHaveLength(0)
  })
})

describe('replayUpdates', () => {
  it('按 seq 升序返回序列化增量', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()

    // 落库 3 条 update
    for (let i = 0; i < 3; i++) {
      await appendUpdate(db, broadcast, {
        realmId: TEST_REALM,
        docRef: TEST_DOC,
        serializedPayload: makeSerializedUpdate(`edit-${i}`),
        actorType: 'human',
        actorId: '4e0f9c1a-0000-0000-0000-000000000001',
        idempotencyKey: `op-${i}`,
      })
    }

    const result = await replayUpdates(db, TEST_REALM, TEST_DOC, null)

    expect(result.updates).toHaveLength(3)
    expect(result.updates.map((u) => u.seq)).toEqual([1, 2, 3])
    expect(result.nextCursor).toBe(3)
    expect(result.hasMore).toBe(false)
  })

  it('游标过滤：只返回 afterSeq 之后的增量', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()

    for (let i = 0; i < 5; i++) {
      await appendUpdate(db, broadcast, {
        realmId: TEST_REALM,
        docRef: TEST_DOC,
        serializedPayload: makeSerializedUpdate(`edit-${i}`),
        actorType: 'human',
        actorId: '4e0f9c1a-0000-0000-0000-000000000001',
        idempotencyKey: `op-${i}`,
      })
    }

    const result = await replayUpdates(db, TEST_REALM, TEST_DOC, 2)

    expect(result.updates).toHaveLength(3)
    expect(result.updates.map((u) => u.seq)).toEqual([3, 4, 5])
    expect(result.nextCursor).toBe(5)
  })

  it('limit 截断时 hasMore=true', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()

    for (let i = 0; i < 5; i++) {
      await appendUpdate(db, broadcast, {
        realmId: TEST_REALM,
        docRef: TEST_DOC,
        serializedPayload: makeSerializedUpdate(`edit-${i}`),
        actorType: 'human',
        actorId: '4e0f9c1a-0000-0000-0000-000000000001',
        idempotencyKey: `op-${i}`,
      })
    }

    const result = await replayUpdates(db, TEST_REALM, TEST_DOC, null, 2)

    expect(result.updates).toHaveLength(2)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(2)
  })

  it('返回的 payload 可反序列化并应用到 Y.Doc', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()

    const sourceDoc = new Y.Doc()
    sourceDoc.getText('content').insert(0, 'round-trip')
    const sourceUpdate = Y.encodeStateAsUpdate(sourceDoc)
    const serialized = serializeUpdate(sourceUpdate)

    await appendUpdate(db, broadcast, {
      realmId: TEST_REALM,
      docRef: TEST_DOC,
      serializedPayload: serialized,
      actorType: 'human',
      actorId: '4e0f9c1a-0000-0000-0000-000000000001',
      idempotencyKey: 'op-rt',
    })

    const result = await replayUpdates(db, TEST_REALM, TEST_DOC, null)
    expect(result.updates).toHaveLength(1)

    const payload = deserializeUpdate(result.updates[0]!.serializedPayload)
    const targetDoc = new Y.Doc()
    Y.applyUpdate(targetDoc, payload)

    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    expect(targetDoc.getText('content').toString()).toBe('round-trip')
  })
})

describe('getCursor', () => {
  it('返回当前最大 seq', async () => {
    const { db } = createMockDb()
    const broadcast = new InMemoryBroadcastPort()

    for (let i = 0; i < 3; i++) {
      await appendUpdate(db, broadcast, {
        realmId: TEST_REALM,
        docRef: TEST_DOC,
        serializedPayload: makeSerializedUpdate(`edit-${i}`),
        actorType: 'human',
        actorId: '4e0f9c1a-0000-0000-0000-000000000001',
        idempotencyKey: `op-${i}`,
      })
    }

    const { cursor } = await getCursor(db, TEST_REALM, TEST_DOC)
    expect(cursor).toBe(3)
  })

  it('无任何增量时返回 null', async () => {
    const { db } = createMockDb()
    const { cursor } = await getCursor(db, TEST_REALM, TEST_DOC)
    expect(cursor).toBeNull()
  })
})

describe('DEFAULT_REPLAY_LIMIT', () => {
  it('默认重放上限为 100', () => {
    expect(DEFAULT_REPLAY_LIMIT).toBe(100)
  })
})
