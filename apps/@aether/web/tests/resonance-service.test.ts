// Resonance Gateway 业务层测试（lib/resonance/service.ts）
// 覆盖：401 / 跨 Realm 404、threads 列表分页过滤、创建 + 审计、PATCH 状态机、
// dialogue 首条消息回写 dialogue_ref、游标分页、entities / currents / projects / index。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

// requireRealmMatch / apiKeyActor 为纯函数，取实际实现；
// 数据库绑定的 resolveApiKey / touchLastUsed / authorizeRequest 用 mock。
vi.mock('@/lib/resonance/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof resonanceAuth>()
  return {
    ...actual,
    resolveApiKey: vi.fn(),
    touchLastUsed: vi.fn(),
    authorizeRequest: vi.fn(),
  }
})

vi.mock('@/lib/webhooks/service', () => ({
  enqueueWebhookDeliveries: vi.fn(),
}))

vi.mock('@/lib/audit-write', () => ({
  recordAuditEntry: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { getDb } from '@/lib/db'
import {
  authorizeRequest,
  resolveApiKey,
  touchLastUsed,
} from '@/lib/resonance/auth'
import type * as resonanceAuth from '@/lib/resonance/auth'
import { enqueueWebhookDeliveries } from '@/lib/webhooks/service'
import { recordAuditEntry } from '@/lib/audit-write'
import { unauthorized } from '@/lib/resonance/protocol'
import {
  handleApiIndex,
  handleCreateDialogue,
  handleCreateThread,
  handleGetRealm,
  handleGetThread,
  handleListCurrents,
  handleListDialogues,
  handleListEntities,
  handleListProjects,
  handleListRealms,
  handleListThreads,
  handlePatchThread,
} from '@/lib/resonance/service'

const mockedGetDb = vi.mocked(getDb)
const mockedResolveApiKey = vi.mocked(resolveApiKey)
const mockedTouchLastUsed = vi.mocked(touchLastUsed)
const mockedAuthorizeRequest = vi.mocked(authorizeRequest)
const mockedEnqueueWebhookDeliveries = vi.mocked(enqueueWebhookDeliveries)
const mockedRecordAuditEntry = vi.mocked(recordAuditEntry)

const REALM_ID = '123e4567-e89b-12d3-a456-426614174000'
const OTHER_REALM_ID = '223e4567-e89b-12d3-a456-426614174000'
const THREAD_ID = '123e4567-e89b-12d3-a456-426614174002'
const PROJECT_ID = '123e4567-e89b-12d3-a456-426614174001'
const DIALOGUE_ID = '123e4567-e89b-12d3-a456-426614174003'
const TOKEN = `aeth_${'k'.repeat(40)}`
const NOW = new Date('2026-09-01T00:00:00.000Z')

const KEY = {
  keyId: 'key-1',
  keyName: 'CLI Key',
  creatorId: 'user-1',
  realm: {
    id: REALM_ID,
    slug: 'alpha',
    name: 'Alpha',
    created_at: NOW,
    updated_at: NOW,
  },
}

function threadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD_ID,
    realm_id: REALM_ID,
    project_id: PROJECT_ID,
    title: 'Thread 标题',
    status: 'open',
    manifestation_url: null,
    dialogue_ref: null,
    code_anchor: { selection: 'const x = 1' },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    seq: 1,
    role: 'user',
    content: 'hello',
    actor_type: 'human',
    actor_id: 'user-1',
    metadata: { via: 'api-key', key_id: 'key-1', key_name: 'CLI Key' },
    created_at: NOW,
    ...overrides,
  }
}

function apiRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://aether.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  })
}

// response.json() 返回 Promise<any>；统一收敛为显式形状，杜绝 any 逃逸
// （对齐 scim-service.test.ts 的 as 范式）。
interface ListBody {
  data: Array<Record<string, unknown>>
  pagination?: Record<string, unknown>
}
interface ErrorBody {
  error: { code: string; message: string }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** 通用可链式查询 mock：支持 drizzle 任意链形状（where/limit/orderBy/returning）。 */
function makeChain(rows: unknown[]): Record<string, unknown> {
  const promise = Promise.resolve(rows)
  const self: Record<string, unknown> = {
    limit: () => self,
    offset: () => self,
    orderBy: () => self,
    innerJoin: () => self,
    where: () => self,
    returning: () => self,
    onConflictDoNothing: () => self,
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  }
  return self
}

function queued(results: unknown[][]): () => Record<string, unknown> {
  let index = 0
  return () => makeChain(results[index++] ?? [])
}

interface MockDbConfig {
  dbSelectResults?: unknown[][]
  dbInsertResults?: unknown[][]
  dbUpdateResults?: unknown[][]
  txSelectResults?: unknown[][]
  txInsertResults?: unknown[][]
  txUpdateResults?: unknown[][]
}

function mockDb(config: MockDbConfig = {}) {
  // 每级（db / tx）各建一次队列：同一级的多次链式查询按顺序消费结果。
  const dbSelectQueue = queued(config.dbSelectResults ?? [])
  const dbInsertQueue = queued(config.dbInsertResults ?? [])
  const dbUpdateQueue = queued(config.dbUpdateResults ?? [])
  const txSelectQueue = queued(config.txSelectResults ?? [])
  const txInsertQueue = queued(config.txInsertResults ?? [])
  const txUpdateQueue = queued(config.txUpdateResults ?? [])
  const tx = {
    select: vi.fn(() => ({ from: txSelectQueue })),
    insert: vi.fn(() => ({ values: txInsertQueue })),
    update: vi.fn(() => ({ set: txUpdateQueue })),
  }
  const db = {
    select: vi.fn(() => ({ from: dbSelectQueue })),
    insert: vi.fn(() => ({ values: dbInsertQueue })),
    update: vi.fn(() => ({ set: dbUpdateQueue })),
    delete: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  }
  mockedGetDb.mockReturnValue(db as never)
  return { db, tx }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedResolveApiKey.mockResolvedValue(KEY)
  mockedTouchLastUsed.mockResolvedValue()
  mockedAuthorizeRequest.mockImplementation(async (request: Request) => {
    const key = await mockedResolveApiKey(
      request.headers.get('authorization'),
    )
    if (key === null) return unauthorized()
    await mockedTouchLastUsed(key.keyId)
    return { key }
  })
  mockedEnqueueWebhookDeliveries.mockResolvedValue()
})

describe('鉴权与 Realm 守卫', () => {
  it('密钥无效 → 401 + WWW-Authenticate，不触发业务查询', async () => {
    mockedResolveApiKey.mockResolvedValue(null)
    const { db } = mockDb()
    const response = await handleListRealms(apiRequest('/api/v1/realms'))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(db.select).not.toHaveBeenCalled()
    expect(mockedTouchLastUsed).not.toHaveBeenCalled()
  })

  it('GET /api/v1/realms 返回密钥绑定 Realm', async () => {
    mockDb()
    const response = await handleListRealms(apiRequest('/api/v1/realms'))
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toEqual({
      id: REALM_ID,
      slug: 'alpha',
      name: 'Alpha',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    })
  })

  it('跨 Realm 路径 → 404（不泄露存在性）', async () => {
    mockDb()
    const response = await handleGetRealm(
      apiRequest(`/api/v1/realms/${OTHER_REALM_ID}`),
      OTHER_REALM_ID,
    )
    expect(response.status).toBe(404)
    const body = await readJson<ErrorBody>(response)
    expect(body.error.code).toBe('not_found')
  })

  it('GET /api/v1 返回资源索引', async () => {
    const response = await handleApiIndex(apiRequest('/api/v1'))
    expect(response.status).toBe(200)
    const body = await readJson<{
      version: string
      resources: Record<string, string>
    }>(response)
    expect(body.version).toBe('v1')
    expect(body.resources).toHaveProperty('threads')
  })
})

describe('GET /api/v1/realms/{realmId}/threads', () => {
  it('非法 status 过滤 → 400', async () => {
    const { db } = mockDb()
    const response = await handleListThreads(
      apiRequest(`/api/v1/realms/${REALM_ID}/threads?status=closed`),
      REALM_ID,
    )
    expect(response.status).toBe(400)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('合法请求返回分页信封', async () => {
    mockDb({
      dbSelectResults: [
        [{ total: 2 }],
        [threadRow({ id: 't1' }), threadRow({ id: 't2', status: 'resolved' })],
      ],
    })
    const response = await handleListThreads(
      apiRequest(`/api/v1/realms/${REALM_ID}/threads?limit=10&offset=5`),
      REALM_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.pagination).toEqual({ total: 2, limit: 10, offset: 5 })
    expect(body.data).toHaveLength(2)
    expect(body.data[0]).not.toHaveProperty('code_anchor')
  })
})

describe('POST /api/v1/realms/{realmId}/threads', () => {
  it('非法 body → 400', async () => {
    const { db } = mockDb()
    const response = await handleCreateThread(
      new Request(`https://aether.example/api/v1/realms/${REALM_ID}/threads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ title: '' }),
      }),
      REALM_ID,
    )
    expect(response.status).toBe(400)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('project 不属于该 Realm → 400', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handleCreateThread(
      new Request(`https://aether.example/api/v1/realms/${REALM_ID}/threads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ project_id: PROJECT_ID, title: '新 Thread' }),
      }),
      REALM_ID,
    )
    expect(response.status).toBe(400)
    const body = await readJson<ErrorBody>(response)
    expect(body.error.message).toContain('project_id')
  })

  it('创建成功 → 201 + write 审计 + detail 视图', async () => {
    const { db } = mockDb({
      dbSelectResults: [[{ id: PROJECT_ID }]],
      txInsertResults: [
        [threadRow({ id: 'new-thread', title: '新 Thread' })],
      ],
    })
    const response = await handleCreateThread(
      new Request(`https://aether.example/api/v1/realms/${REALM_ID}/threads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          project_id: PROJECT_ID,
          title: '新 Thread',
          code_anchor: 'const x = 1',
        }),
      }),
      REALM_ID,
    )
    expect(response.status).toBe(201)
    const body = await readJson<{
      id: string
      code_anchor?: { selection: string } | null
    }>(response)
    expect(body.id).toBe('new-thread')
    expect(body.code_anchor).toEqual({ selection: 'const x = 1' })

    expect(db.transaction).toHaveBeenCalled()
    expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'write',
        actor: { actorType: 'entity', actorId: 'api-key:key-1' },
      }),
    )
  })
})

describe('GET/PATCH /api/v1/threads/{threadId}', () => {
  it('Thread 不存在 → 404', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handleGetThread(apiRequest(`/api/v1/threads/x`), 'x')
    expect(response.status).toBe(404)
  })

  it('Thread 详情含 code_anchor', async () => {
    mockDb({ dbSelectResults: [[threadRow()]] })
    const response = await handleGetThread(
      apiRequest(`/api/v1/threads/${THREAD_ID}`),
      THREAD_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<{
      code_anchor?: { selection: string } | null
    }>(response)
    expect(body.code_anchor).toEqual({ selection: 'const x = 1' })
  })

  it('非法状态迁移（open → archived）→ 400 invalid_status_transition', async () => {
    const { db } = mockDb({ dbSelectResults: [[threadRow()]] })
    const response = await handlePatchThread(
      new Request(`https://aether.example/api/v1/threads/${THREAD_ID}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ status: 'archived' }),
      }),
      THREAD_ID,
    )
    expect(response.status).toBe(400)
    const body = await readJson<ErrorBody>(response)
    expect(body.error.code).toBe('invalid_status_transition')
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('合法迁移（open → in_review）→ 200 + write 审计', async () => {
    const { tx } = mockDb({
      dbSelectResults: [[threadRow()]],
      txUpdateResults: [[threadRow({ status: 'in_review' })]],
    })
    const response = await handlePatchThread(
      new Request(`https://aether.example/api/v1/threads/${THREAD_ID}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ status: 'in_review' }),
      }),
      THREAD_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<{ status: string }>(response)
    expect(body.status).toBe('in_review')
    expect(tx.update).toHaveBeenCalled()
    expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'write' }),
    )
  })

  it('manifestation_url 解绑（null）→ 200', async () => {
    mockDb({
      dbSelectResults: [[threadRow({ manifestation_url: 'https://a.dev' })]],
      txUpdateResults: [[threadRow({ manifestation_url: null })]],
    })
    const response = await handlePatchThread(
      new Request(`https://aether.example/api/v1/threads/${THREAD_ID}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ manifestation_url: null }),
      }),
      THREAD_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<Record<string, unknown>>(response)
    expect(body).not.toHaveProperty('manifestation_url')
  })
})

describe('GET/POST /api/v1/threads/{threadId}/dialogues', () => {
  it('Thread 无对话 → 空列表', async () => {
    mockDb({ dbSelectResults: [[threadRow({ dialogue_ref: null })]] })
    const response = await handleListDialogues(
      apiRequest(`/api/v1/threads/${THREAD_ID}/dialogues`),
      THREAD_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data).toEqual([])
    expect(body.pagination).toEqual({ next_after: null, limit: 50 })
  })

  it('非法 after 参数 → 400', async () => {
    mockDb({ dbSelectResults: [[threadRow({ dialogue_ref: DIALOGUE_ID })]] })
    const response = await handleListDialogues(
      apiRequest(`/api/v1/threads/${THREAD_ID}/dialogues?after=zzz`),
      THREAD_ID,
    )
    expect(response.status).toBe(400)
  })

  it('游标分页：取满一页时返回 next_after', async () => {
    mockDb({
      dbSelectResults: [
        [threadRow({ dialogue_ref: DIALOGUE_ID })],
        [messageRow({ seq: 1 }), messageRow({ id: 'm-2', seq: 2 })],
      ],
    })
    const response = await handleListDialogues(
      apiRequest(
        `/api/v1/threads/${THREAD_ID}/dialogues?limit=2&after=0`,
      ),
      THREAD_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data).toHaveLength(2)
    expect(body.pagination).toEqual({ next_after: 2, limit: 2 })
  })

  it('非法 role → 400', async () => {
    mockDb({ dbSelectResults: [[threadRow()]] })
    const response = await handleCreateDialogue(
      new Request(
        `https://aether.example/api/v1/threads/${THREAD_ID}/dialogues`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ role: 'system', content: 'x' }),
        },
      ),
      THREAD_ID,
    )
    expect(response.status).toBe(400)
  })

  it('首条消息：回写 dialogue_ref + converse 审计 + 创建者归因', async () => {
    const { tx } = mockDb({
      dbSelectResults: [[threadRow({ dialogue_ref: null })]],
      txUpdateResults: [
        [{ dialogue_ref: DIALOGUE_ID }],
        [],
      ],
      txInsertResults: [[messageRow()]],
    })
    const response = await handleCreateDialogue(
      new Request(
        `https://aether.example/api/v1/threads/${THREAD_ID}/dialogues`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ content: 'hello' }),
        },
      ),
      THREAD_ID,
    )
    expect(response.status).toBe(201)
    const body = await readJson<{
      actor_type: string
      actor_id: string
      metadata: Record<string, unknown>
    }>(response)
    expect(body.actor_type).toBe('human')
    expect(body.actor_id).toBe('user-1')
    expect(body.metadata).toEqual({
      via: 'api-key',
      key_id: 'key-1',
      key_name: 'CLI Key',
    })

    // 首条消息必须竞争回写 dialogue_ref（update 被调用两次：claim + touch）
    expect(tx.update).toHaveBeenCalledTimes(2)
    expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'converse' }),
    )
    const auditInput = mockedRecordAuditEntry.mock.calls.at(-1)?.[1]
    expect(auditInput?.target).toMatchObject({
      dialogue_id: DIALOGUE_ID,
      thread_id: THREAD_ID,
    })
  })

  it('后续消息：直接挂接既有 dialogue_ref', async () => {
    const { tx } = mockDb({
      dbSelectResults: [[threadRow({ dialogue_ref: DIALOGUE_ID })]],
      txUpdateResults: [[]],
      txInsertResults: [[messageRow({ seq: 5 })]],
    })
    const response = await handleCreateDialogue(
      new Request(
        `https://aether.example/api/v1/threads/${THREAD_ID}/dialogues`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ role: 'assistant', content: 'result' }),
        },
      ),
      THREAD_ID,
    )
    expect(response.status).toBe(201)
    // 既有 dialogue_ref 时仅一次 update（touch thread.updated_at）
    expect(tx.update).toHaveBeenCalledTimes(1)
  })
})

describe('entities / currents / projects', () => {
  it('projects 列表资源形状', async () => {
    mockDb({
      dbSelectResults: [
        [
          {
            id: PROJECT_ID,
            slug: 'app',
            name: 'App',
            default_branch: 'main',
            created_at: NOW,
          },
        ],
      ],
    })
    const response = await handleListProjects(
      apiRequest(`/api/v1/realms/${REALM_ID}/projects`),
      REALM_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data[0]).toEqual({
      id: PROJECT_ID,
      slug: 'app',
      name: 'App',
      default_branch: 'main',
      created_at: NOW.toISOString(),
    })
  })

  it('entities 列表资源形状', async () => {
    mockDb({
      dbSelectResults: [
        [
          {
            id: 'e-1',
            display_name: 'Orchestrator',
            status: 'active',
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      ],
    })
    const response = await handleListEntities(
      apiRequest(`/api/v1/realms/${REALM_ID}/entities`),
      REALM_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data[0]?.display_name).toBe('Orchestrator')
  })

  it('currents 列表资源形状', async () => {
    mockDb({
      dbSelectResults: [
        [
          {
            id: 'c-1',
            doc_ref: `realm:${REALM_ID}:main`,
            connection_state: 'active',
            presence_snapshot: { s1: { actor_id: 'user-1' } },
            last_converge_at: NOW,
            updated_at: NOW,
          },
        ],
      ],
    })
    const response = await handleListCurrents(
      apiRequest(`/api/v1/realms/${REALM_ID}/currents`),
      REALM_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data[0]?.presence_snapshot).toEqual({
      s1: { actor_id: 'user-1' },
    })
    expect(body.data[0]?.last_converge_at).toBe(NOW.toISOString())
  })
})

describe('Webhook 事件发射（transactional outbox 接入）', () => {
  it('创建 Thread → 同事务入队 thread.created', async () => {
    mockDb({
      dbSelectResults: [[{ id: PROJECT_ID }]],
      txInsertResults: [[threadRow({ id: 'new-thread', title: '新 Thread' })]],
    })
    const response = await handleCreateThread(
      new Request(`https://aether.example/api/v1/realms/${REALM_ID}/threads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ project_id: PROJECT_ID, title: '新 Thread' }),
      }),
      REALM_ID,
    )
    expect(response.status).toBe(201)
    expect(mockedEnqueueWebhookDeliveries).toHaveBeenCalledTimes(1)
    expect(mockedEnqueueWebhookDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      {
        realmId: REALM_ID,
        eventType: 'thread.created',
        data: {
          thread_id: 'new-thread',
          project_id: PROJECT_ID,
          title: '新 Thread',
        },
      },
    )
  })

  it('状态迁移 → thread.status_changed（from / to）', async () => {
    mockDb({
      dbSelectResults: [[threadRow()]],
      txUpdateResults: [[threadRow({ status: 'in_review' })]],
    })
    const response = await handlePatchThread(
      new Request(`https://aether.example/api/v1/threads/${THREAD_ID}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ status: 'in_review' }),
      }),
      THREAD_ID,
    )
    expect(response.status).toBe(200)
    expect(mockedEnqueueWebhookDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      {
        realmId: REALM_ID,
        eventType: 'thread.status_changed',
        data: { thread_id: THREAD_ID, from: 'open', to: 'in_review' },
      },
    )
  })

  it('非状态字段的 PATCH 不发射事件', async () => {
    mockDb({
      dbSelectResults: [[threadRow({ manifestation_url: 'https://a.dev' })]],
      txUpdateResults: [[threadRow({ manifestation_url: null })]],
    })
    const response = await handlePatchThread(
      new Request(`https://aether.example/api/v1/threads/${THREAD_ID}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ manifestation_url: null }),
      }),
      THREAD_ID,
    )
    expect(response.status).toBe(200)
    expect(mockedEnqueueWebhookDeliveries).not.toHaveBeenCalled()
  })

  it('对话消息 → dialogue.message_created', async () => {
    mockDb({
      dbSelectResults: [[threadRow({ dialogue_ref: DIALOGUE_ID })]],
      txUpdateResults: [[]],
      txInsertResults: [[messageRow({ seq: 5, role: 'assistant' })]],
    })
    const response = await handleCreateDialogue(
      new Request(
        `https://aether.example/api/v1/threads/${THREAD_ID}/dialogues`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ role: 'assistant', content: 'result' }),
        },
      ),
      THREAD_ID,
    )
    expect(response.status).toBe(201)
    expect(mockedEnqueueWebhookDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      {
        realmId: REALM_ID,
        eventType: 'dialogue.message_created',
        data: {
          thread_id: THREAD_ID,
          dialogue_id: DIALOGUE_ID,
          message_id: 'm-1',
          seq: 5,
          role: 'assistant',
        },
      },
    )
  })
})
