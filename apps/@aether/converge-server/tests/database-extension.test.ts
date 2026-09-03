// @aether/converge-server · Database Extension 测试
// 用 drizzle-orm/pg-proxy mock 验证 onChange（追加增量）→ onLoadDocument（合并重放）闭环。
// 与 @aether/web/tests/channel-service.test.ts 同构。
import { describe, it, expect } from 'vitest'
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy'
import * as Y from 'yjs'
import type { Document, onChangePayload, onLoadDocumentPayload } from '@hocuspocus/server'
import type { UpdateLogDb } from '@aether/db'
import { AetherDatabaseExtension } from '../src/extensions/database.js'
import {
  formatDocumentName,
  parseDocumentName,
} from '../src/document-name.js'

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
const TEST_DOC_NAME = formatDocumentName(TEST_REALM, TEST_DOC)

interface MockStore {
  rows: Record<string, unknown>[]
  nextSeq: number
}

function toArrayRow(record: Record<string, unknown>): unknown[] {
  return CRDT_COLUMN_ORDER.map((key) => record[key])
}

/** 创建 pg-proxy mock db，模拟 crdt_updates 的插入与查询 */
function createMockDb(initialRows: Record<string, unknown>[] = []) {
  const store: MockStore = {
    rows: [...initialRows],
    nextSeq: initialRows.length > 0
      ? Math.max(...initialRows.map((r) => r.seq as number)) + 1
      : 1,
  }

  const callback: RemoteCallback = async (sql, params, _method) => {
    await Promise.resolve()

    // insert into crdt_updates ... on conflict do nothing returning *
    if (sql.includes('insert into "crdt_updates"')) {
      const idempotencyKey = params[5] as string
      const existing = store.rows.find(
        (r) => r.idempotency_key === idempotencyKey && r.doc_ref === params[1],
      )
      if (existing) {
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
  return { db, store }
}

/** 生成一条 Yjs update（向 Y.Text 插入文本） */
function makeYjsUpdate(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  return Y.encodeStateAsUpdate(doc)
}

/** 创建 onChange mock payload */
function makeOnChangePayload(
  documentName: string,
  update: Uint8Array,
  socketId = 'sock-1',
  context?: unknown,
): onChangePayload {
  return {
    clientsCount: 1,
    context: context ?? {},
    document: new Y.Doc() as unknown as Document,
    documentName,
    instance: {} as unknown as onChangePayload['instance'],
    requestHeaders: {},
    requestParameters: new URLSearchParams(),
    update,
    socketId,
    transactionOrigin: null,
  }
}

/** 创建 onLoadDocument mock payload */
function makeOnLoadDocumentPayload(
  documentName: string,
): onLoadDocumentPayload {
  return {
    context: {},
    document: new Y.Doc() as unknown as Document,
    documentName,
    instance: {} as unknown as onLoadDocumentPayload['instance'],
    requestHeaders: {},
    requestParameters: new URLSearchParams(),
    socketId: '',
    connection: { readOnly: false, requiresAuthentication: false, isAuthenticated: true },
  }
}

describe('document-name', () => {
  it('formatDocumentName + parseDocumentName 往返', () => {
    const name = formatDocumentName(TEST_REALM, TEST_DOC)
    const parsed = parseDocumentName(name)
    expect(parsed.realmId).toBe(TEST_REALM)
    expect(parsed.docRef).toBe(TEST_DOC)
  })

  it('docRef 含冒号时正确解析', () => {
    const name = formatDocumentName('realm-123', 'doc:realm-a:current-1')
    const parsed = parseDocumentName(name)
    expect(parsed.realmId).toBe('realm-123')
    expect(parsed.docRef).toBe('doc:realm-a:current-1')
  })

  it('无分隔符时抛错', () => {
    expect(() => parseDocumentName('invalid')).toThrow('Invalid documentName')
  })

  it('realmId 为空时抛错', () => {
    expect(() => parseDocumentName('/docRef')).toThrow('Invalid documentName')
  })
})

describe('AetherDatabaseExtension - onChange', () => {
  it('增量 update 落库到 crdt_updates', async () => {
    const { db, store } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })
    const update = makeYjsUpdate('hello world')

    await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, update))

    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]!.realm_id).toBe(TEST_REALM)
    expect(store.rows[0]!.doc_ref).toBe(TEST_DOC)
    expect(Buffer.from(store.rows[0]!.payload as Uint8Array)).toEqual(Buffer.from(update))
    expect(store.rows[0]!.actor_id).toBe('hocuspocus-server')
    expect(store.rows[0]!.actor_type).toBe('entity')
    expect(store.rows[0]!.idempotency_key).toContain('hocuspocus:')
  })

  it('多条 update 按序追加，seq 单调递增', async () => {
    const { db, store } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })

    for (let i = 0; i < 3; i++) {
      await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, makeYjsUpdate(`edit-${i}`)))
    }

    expect(store.rows).toHaveLength(3)
    expect(store.rows.map((r) => r.seq)).toEqual([1, 2, 3])
  })

  it('context 中的 actor 身份优先于默认值', async () => {
    const { db, store } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })

    await ext.onChange(
      makeOnChangePayload(
        TEST_DOC_NAME,
        makeYjsUpdate('context-test'),
        'sock-2',
        { actorType: 'human', actorId: 'user-abc' },
      ),
    )

    expect(store.rows[0]!.actor_type).toBe('human')
    expect(store.rows[0]!.actor_id).toBe('user-abc')
  })

  it('idempotencyKey 包含 socketId', async () => {
    const { db, store } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })

    await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, makeYjsUpdate('x'), 'sock-99'))

    expect(store.rows[0]!.idempotency_key).toContain('sock-99')
  })
})

describe('AetherDatabaseExtension - onLoadDocument', () => {
  it('空文档时不报错，不应用任何 update', async () => {
    const { db } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })
    const payload = makeOnLoadDocumentPayload(TEST_DOC_NAME)

    await ext.onLoadDocument(payload)

    // 空 Y.Doc 的 content 应为空
    expect(payload.document.getText('content').toJSON()).toBe('')
  })

  it('读取增量并应用到 Document', async () => {
    const { db } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })

    // 先追加一条 update
    const update = makeYjsUpdate('loaded content')
    await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, update))

    // 创建新 document 模拟冷启动
    const payload = makeOnLoadDocumentPayload(TEST_DOC_NAME)
    await ext.onLoadDocument(payload)

    expect(payload.document.getText('content').toJSON()).toBe('loaded content')
  })

  it('多条增量按序合并', async () => {
    const { db } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })

    // 模拟同一文档的多次编辑：捕获真正的增量 update（而非全量快照）
    const sourceDoc = new Y.Doc()
    const updates: Uint8Array[] = []
    sourceDoc.on('update', (u: Uint8Array) => updates.push(u))

    sourceDoc.getText('content').insert(0, 'first')
    sourceDoc.getText('content').insert(5, 'second')
    sourceDoc.getText('content').insert(11, 'third')

    for (const u of updates) {
      await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, u))
    }

    const payload = makeOnLoadDocumentPayload(TEST_DOC_NAME)
    await ext.onLoadDocument(payload)

    expect(payload.document.getText('content').toJSON()).toBe('firstsecondthird')
  })
})

describe('AetherDatabaseExtension - 闭环', () => {
  it('onChange 追加 → onLoadDocument 恢复 → 文本一致', async () => {
    const { db } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })

    // 模拟客户端编辑：生成增量 update 并追加
    const sourceDoc = new Y.Doc()
    sourceDoc.getText('content').insert(0, 'round-trip')
    const update = Y.encodeStateAsUpdate(sourceDoc)

    await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, update))

    // 模拟服务端冷启动：新 Document 加载
    const payload = makeOnLoadDocumentPayload(TEST_DOC_NAME)
    await ext.onLoadDocument(payload)

    expect(payload.document.getText('content').toJSON()).toBe('round-trip')
  })

  it('多文档隔离：不同 documentName 的 update 不串扰', async () => {
    const { db } = createMockDb()
    const ext = new AetherDatabaseExtension({ db })

    const docNameA = formatDocumentName(TEST_REALM, 'doc:a')
    const docNameB = formatDocumentName(TEST_REALM, 'doc:b')

    await ext.onChange(makeOnChangePayload(docNameA, makeYjsUpdate('content-a')))
    await ext.onChange(makeOnChangePayload(docNameB, makeYjsUpdate('content-b')))

    const payloadA = makeOnLoadDocumentPayload(docNameA)
    await ext.onLoadDocument(payloadA)
    expect(payloadA.document.getText('content').toJSON()).toBe('content-a')

    const payloadB = makeOnLoadDocumentPayload(docNameB)
    await ext.onLoadDocument(payloadB)
    expect(payloadB.document.getText('content').toJSON()).toBe('content-b')
  })
})
