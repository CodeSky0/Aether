// @aether/converge-server · Converge Telemetry 埋点测试
// 验证 AetherDatabaseExtension 注入 metrics 后的埋点行为：
//   onLoadDocument → coldStartSeconds + crdtApplyFailuresTotal
//   onChange → persistSeconds + persistDuplicatesTotal
// 以及未注入 metrics 时行为不变（向后兼容）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Y from 'yjs'
import type {
  onChangePayload,
  onLoadDocumentPayload,
  Document,
} from '@hocuspocus/server'

vi.mock('@aether/db', () => ({
  appendCrdtUpdate: vi.fn(),
  readCrdtUpdatesSince: vi.fn(),
}))

import { appendCrdtUpdate, readCrdtUpdatesSince } from '@aether/db'
import { AetherDatabaseExtension } from '../src/extensions/database.js'
import { createConvergeMetrics } from '../src/telemetry.js'
import {
  formatDocumentName,
} from '../src/document-name.js'

const mockedAppendCrdtUpdate = vi.mocked(appendCrdtUpdate)
const mockedReadCrdtUpdatesSince = vi.mocked(readCrdtUpdatesSince)

const TEST_REALM = '550e8400-e29b-41d4-a716-446655440000'
const TEST_DOC = 'doc:realm-a:current-1'
const TEST_DOC_NAME = formatDocumentName(TEST_REALM, TEST_DOC)

function makeYjsUpdate(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  return Y.encodeStateAsUpdate(doc)
}

function makeOnChangePayload(
  documentName: string,
  update: Uint8Array,
  socketId = 'sock-1',
): onChangePayload {
  return {
    clientsCount: 1,
    context: {},
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AetherDatabaseExtension · Converge Telemetry 埋点', () => {
  it('onChange 记录持久化延迟（persistSeconds）', async () => {
    const metrics = createConvergeMetrics(true)
    const ext = new AetherDatabaseExtension({
      db: {} as never,
      metrics,
    })
    mockedAppendCrdtUpdate.mockResolvedValue({
      id: 'id-1',
      realm_id: TEST_REALM,
      doc_ref: TEST_DOC,
      seq: 1,
      payload: makeYjsUpdate('a'),
      actor_type: 'entity',
      actor_id: 'hocuspocus-server',
      idempotency_key: 'k-1',
      created_at: new Date(),
    } as never)

    await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, makeYjsUpdate('a')))

    const s = metrics.persistSeconds.get()
    expect(s?.count).toBe(1)
    expect(s?.sum).toBeGreaterThanOrEqual(0)
    expect(metrics.persistDuplicatesTotal.get()).toBe(0)
  })

  it('onChange 幂等键命中 → persistDuplicatesTotal +1', async () => {
    const metrics = createConvergeMetrics(true)
    const ext = new AetherDatabaseExtension({
      db: {} as never,
      metrics,
    })
    mockedAppendCrdtUpdate.mockResolvedValue(null)

    await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, makeYjsUpdate('a')))

    expect(metrics.persistDuplicatesTotal.get()).toBe(1)
    expect(metrics.persistSeconds.get()?.count).toBe(1)
  })

  it('onLoadDocument 记录冷启动延迟（coldStartSeconds）', async () => {
    const metrics = createConvergeMetrics(true)
    const ext = new AetherDatabaseExtension({
      db: {} as never,
      metrics,
    })
    mockedReadCrdtUpdatesSince.mockResolvedValue([])

    await ext.onLoadDocument(makeOnLoadDocumentPayload(TEST_DOC_NAME))

    const s = metrics.coldStartSeconds.get()
    expect(s?.count).toBe(1)
    expect(s?.sum).toBeGreaterThanOrEqual(0)
    expect(metrics.crdtApplyFailuresTotal.get()).toBe(0)
  })

  it('onLoadDocument applyUpdate 失败 → crdtApplyFailuresTotal +1 且抛错', async () => {
    const metrics = createConvergeMetrics(true)
    const ext = new AetherDatabaseExtension({
      db: {} as never,
      metrics,
    })
    mockedReadCrdtUpdatesSince.mockResolvedValue([
      {
        id: 'id-1',
        realm_id: TEST_REALM,
        doc_ref: TEST_DOC,
        seq: 1,
        payload: new Uint8Array([0xff, 0xff, 0xff]),
        actor_type: 'entity',
        actor_id: 'x',
        idempotency_key: 'k-1',
        created_at: new Date(),
      } as never,
    ])

    await expect(
      ext.onLoadDocument(makeOnLoadDocumentPayload(TEST_DOC_NAME)),
    ).rejects.toThrow()
    expect(metrics.crdtApplyFailuresTotal.get()).toBe(1)
  })

  it('未注入 metrics → 行为不变（onChange 不抛错）', async () => {
    const ext = new AetherDatabaseExtension({ db: {} as never })
    mockedAppendCrdtUpdate.mockResolvedValue(null)

    await expect(
      ext.onChange(makeOnChangePayload(TEST_DOC_NAME, makeYjsUpdate('a'))),
    ).resolves.toBeUndefined()
  })

  it('未注入 metrics → 行为不变（onLoadDocument 不抛错）', async () => {
    const ext = new AetherDatabaseExtension({ db: {} as never })
    mockedReadCrdtUpdatesSince.mockResolvedValue([])

    await expect(
      ext.onLoadDocument(makeOnLoadDocumentPayload(TEST_DOC_NAME)),
    ).resolves.toBeUndefined()
  })

  it('disabled metrics → 埋点 no-op 但行为不变', async () => {
    const metrics = createConvergeMetrics(false)
    const ext = new AetherDatabaseExtension({
      db: {} as never,
      metrics,
    })
    mockedAppendCrdtUpdate.mockResolvedValue(null)

    await ext.onChange(makeOnChangePayload(TEST_DOC_NAME, makeYjsUpdate('a')))

    expect(metrics.persistSeconds.get()).toBeUndefined()
    expect(metrics.persistDuplicatesTotal.get()).toBe(0)
    expect(metrics.registry.render()).not.toContain('converge_persist_seconds_count')
  })
})

describe('Converge Telemetry · /metrics 导出', () => {
  it('registry.render 输出 Prometheus 文本格式', () => {
    const metrics = createConvergeMetrics(true)
    metrics.connectionsTotal.inc(3, { status: 'success' })
    metrics.connectionsTotal.inc(1, { status: 'failure' })
    metrics.coldStartSeconds.observe(0.12)
    metrics.persistSeconds.observe(0.03)
    metrics.persistDuplicatesTotal.inc(2)
    metrics.crdtApplyFailuresTotal.inc()

    const text = metrics.registry.render()
    expect(text).toContain('# TYPE converge_connections_total counter')
    expect(text).toContain('converge_connections_total{status="success"} 3')
    expect(text).toContain('converge_connections_total{status="failure"} 1')
    expect(text).toContain('# TYPE converge_cold_start_seconds histogram')
    expect(text).toContain('converge_cold_start_seconds_count 1')
    expect(text).toContain('# TYPE converge_persist_seconds histogram')
    expect(text).toContain('converge_persist_seconds_count 1')
    expect(text).toContain('converge_persist_duplicates_total 2')
    expect(text).toContain('converge_crdt_apply_failures_total 1')
  })
})
