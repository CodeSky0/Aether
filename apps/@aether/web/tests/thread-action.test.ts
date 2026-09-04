// 会话通道 createThread 测试（lib/threads.ts → core.ts，M3.18 API-First 收口）
// 覆盖：消费业务核心后的行为——审计归因当前用户（source=session）、
// thread.created 事件入队、无会话回退 web-client、core 失败传播 ActionResult、
// 入参 zod 校验。
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({
  requireEntitlement: vi.fn(),
  requireRealmAccess: vi.fn(),
  resolveCurrentActor: vi.fn(),
}))

vi.mock('@/lib/audit-write', () => ({
  recordAuditEntry: vi.fn(),
}))

vi.mock('@/lib/webhooks/service', () => ({
  enqueueWebhookDeliveries: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { getDb } from '@/lib/db'
import {
  requireEntitlement,
  resolveCurrentActor,
} from '@/lib/auth-guard'
import { recordAuditEntry } from '@/lib/audit-write'
import { enqueueWebhookDeliveries } from '@/lib/webhooks/service'
import { createThread } from '@/lib/threads'

const mockedGetDb = vi.mocked(getDb)
const mockedRequireEntitlement = vi.mocked(requireEntitlement)
const mockedResolveCurrentActor = vi.mocked(resolveCurrentActor)
const mockedRecordAuditEntry = vi.mocked(recordAuditEntry)
const mockedEnqueue = vi.mocked(enqueueWebhookDeliveries)

const REALM_ID = '123e4567-e89b-12d3-a456-426614174000'
const PROJECT_ID = '223e4567-e89b-12d3-a456-426614174001'
const NOW = new Date('2026-09-01T00:00:00.000Z')

function makeChain(rows: unknown[]): Record<string, unknown> {
  const promise = Promise.resolve(rows)
  const self: Record<string, unknown> = {
    limit: () => self,
    offset: () => self,
    orderBy: () => self,
    where: () => self,
    returning: () => self,
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  }
  return self
}

interface MockDbConfig {
  dbSelectResults?: unknown[][]
  txInsertResults?: unknown[][]
  txInsertValues?: unknown[]
}

function mockDb(config: MockDbConfig = {}): void {
  const selectQueue = [...(config.dbSelectResults ?? [])]
  const insertQueue = [...(config.txInsertResults ?? [])]
  const insertValues = config.txInsertValues ?? []
  const tx = {
    insert: vi.fn(() => ({
      values: (value: unknown) => {
        insertValues.push(value)
        return makeChain(insertQueue.shift() ?? [])
      },
    })),
  }
  const db = {
    select: vi.fn(() => ({ from: () => makeChain(selectQueue.shift() ?? []) })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  }
  mockedGetDb.mockReturnValue(db as never)
}

const threadRow = {
  id: 'new-thread',
  realm_id: REALM_ID,
  project_id: PROJECT_ID,
  title: '新 Thread',
  status: 'open',
  manifestation_url: null,
  dialogue_ref: null,
  code_anchor: null,
  created_at: NOW,
  updated_at: NOW,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRequireEntitlement.mockResolvedValue()
  mockedResolveCurrentActor.mockResolvedValue({
    actorType: 'human',
    actorId: 'user-1',
  })
  mockedRecordAuditEntry.mockResolvedValue()
  mockedEnqueue.mockResolvedValue()
})

describe('createThread（会话通道消费 core）', () => {
  it('成功 → 返回 {id,title} + 审计归因当前用户（source=session）+ thread.created 入队', async () => {
    const insertValues: unknown[] = []
    mockDb({
      dbSelectResults: [[{ id: PROJECT_ID }]],
      txInsertResults: [[threadRow]],
      txInsertValues: insertValues,
    })

    const result = await createThread({
      realmId: REALM_ID,
      projectId: PROJECT_ID,
      title: '新 Thread',
    })

    expect(result).toEqual({ success: true, data: { id: 'new-thread', title: '新 Thread' } })

    // 入库值：code_anchor 缺省不设置
    expect(insertValues[0]).toMatchObject({
      realm_id: REALM_ID,
      project_id: PROJECT_ID,
      title: '新 Thread',
      manifestation_url: null,
    })

    // 审计：human actor + source=session + 通道前缀幂等键
    expect(mockedRecordAuditEntry).toHaveBeenCalledTimes(1)
    const auditInput = mockedRecordAuditEntry.mock.calls[0]?.[1]
    expect(auditInput?.actor).toEqual({ actorType: 'human', actorId: 'user-1' })
    expect(auditInput?.action).toBe('write')
    expect(auditInput?.target).toMatchObject({
      kind: 'thread',
      thread_id: 'new-thread',
      source: 'session',
    })
    expect(auditInput?.idempotencyKey).toBe('session:thread.create:new-thread')

    // 事务性 outbox
    expect(mockedEnqueue).toHaveBeenCalledWith(expect.anything(), {
      realmId: REALM_ID,
      eventType: 'thread.created',
      data: {
        thread_id: 'new-thread',
        project_id: PROJECT_ID,
        title: '新 Thread',
      },
    })
  })

  it('codeAnchor 选区 → code_anchor: { selection }', async () => {
    const insertValues: unknown[] = []
    mockDb({
      dbSelectResults: [[{ id: PROJECT_ID }]],
      txInsertResults: [[threadRow]],
      txInsertValues: insertValues,
    })

    const result = await createThread({
      realmId: REALM_ID,
      projectId: PROJECT_ID,
      title: '带选区',
      codeAnchor: 'const x = 1',
    })

    expect(result.success).toBe(true)
    expect(insertValues[0]).toMatchObject({
      code_anchor: { selection: 'const x = 1' },
    })
  })

  it('无会话 → 回退 web-client 归因', async () => {
    mockedResolveCurrentActor.mockResolvedValue(null)
    mockDb({
      dbSelectResults: [[{ id: PROJECT_ID }]],
      txInsertResults: [[threadRow]],
    })

    const result = await createThread({
      realmId: REALM_ID,
      projectId: PROJECT_ID,
      title: '匿名态',
    })

    expect(result.success).toBe(true)
    const auditInput = mockedRecordAuditEntry.mock.calls[0]?.[1]
    expect(auditInput?.actor).toEqual({ actorType: 'human', actorId: 'web-client' })
  })

  it('project 不属于该 Realm → ActionResult 失败（不写库不审计）', async () => {
    mockDb({ dbSelectResults: [[]] })

    const result = await createThread({
      realmId: REALM_ID,
      projectId: PROJECT_ID,
      title: '失败路径',
    })

    expect(result).toEqual({
      success: false,
      error: 'project_id does not reference a project in this realm.',
    })
    expect(mockedRecordAuditEntry).not.toHaveBeenCalled()
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('非法输入（空标题）→ zod 失败', async () => {
    const result = await createThread({
      realmId: REALM_ID,
      projectId: PROJECT_ID,
      title: '   ',
    })

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toContain('title')
    expect(mockedRecordAuditEntry).not.toHaveBeenCalled()
  })
})
