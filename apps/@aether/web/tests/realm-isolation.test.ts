// Realm Isolation 生产级验证（M3.20）
// 验证多租户边界：令牌绑定单一 Realm，跨 Realm 一律 404 且不泄露存在性。
// 覆盖三层守卫：鉴权层令牌绑定 → requireRealmMatch 路径守卫 → requireThreadRow
// 资源守卫；以及 core 层 project 归属校验（写隔离）与列表查询 realm_id 过滤。
// 沿 resonance-service.test.ts 的 mock 范式，纯单测无 Postgres 依赖。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

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
  handleCreateDialogue,
  handleCreateThread,
  handleGetRealm,
  handleGetThread,
  handleListCurrents,
  handleListDialogues,
  handleListEntities,
  handleListProjects,
  handleListThreads,
  handlePatchThread,
} from '@/lib/resonance/service'

const mockedGetDb = vi.mocked(getDb)
const mockedResolveApiKey = vi.mocked(resolveApiKey)
const mockedTouchLastUsed = vi.mocked(touchLastUsed)
const mockedAuthorizeRequest = vi.mocked(authorizeRequest)
const mockedEnqueueWebhookDeliveries = vi.mocked(enqueueWebhookDeliveries)
const mockedRecordAuditEntry = vi.mocked(recordAuditEntry)

const REALM_A = '11111111-1111-1111-1111-111111111111'
const REALM_B = '22222222-2222-2222-2222-222222222222'
const PROJECT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PROJECT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const THREAD_A = 't0000000-a000-a000-a000-t0000000a000'
const THREAD_B = 't1111111-b111-b111-b111-t1111111b111'
const NOW = new Date('2026-09-05T00:00:00.000Z')
const TOKEN_A = `aeth_${'a'.repeat(40)}`

/** 令牌 A 绑定 Realm A（隔离验证的主体）。 */
const KEY_A = {
  keyId: 'key-a',
  keyName: 'Realm A Key',
  creatorId: 'user-a',
  kind: 'api-key' as const,
  realm: {
    id: REALM_A,
    slug: 'alpha',
    name: 'Alpha',
    created_at: NOW,
    updated_at: NOW,
  },
}

function threadRow(realmId: string, threadId: string, projectId: string) {
  return {
    id: threadId,
    realm_id: realmId,
    project_id: projectId,
    title: `Thread ${realmId}`,
    status: 'open',
    manifestation_url: null,
    dialogue_ref: null,
    code_anchor: null,
    created_at: NOW,
    updated_at: NOW,
  }
}

function projectRow(realmId: string, projectId: string) {
  return {
    id: projectId,
    slug: `proj-${realmId.slice(0, 4)}`,
    name: `Project ${realmId.slice(0, 4)}`,
    default_branch: 'main',
    created_at: NOW,
  }
}

function apiRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://aether.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN_A}`,
      ...(init.headers ?? {}),
    },
  })
}

interface ErrorBody {
  error: { code: string; message: string }
}
interface ListBody {
  data: Array<Record<string, unknown>>
  pagination?: Record<string, unknown>
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** 通用可链式查询 mock：支持 drizzle 任意链形状。 */
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
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  }
  mockedGetDb.mockReturnValue(db as never)
  return { db, tx }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedResolveApiKey.mockResolvedValue(KEY_A)
  mockedTouchLastUsed.mockResolvedValue()
  mockedAuthorizeRequest.mockImplementation(async (request: Request) => {
    const key = await mockedResolveApiKey(request.headers.get('authorization'))
    if (key === null) return unauthorized()
    await mockedTouchLastUsed(key)
    return { key }
  })
  mockedEnqueueWebhookDeliveries.mockResolvedValue()
  mockedRecordAuditEntry.mockResolvedValue()
})

// ---- 路径守卫：/realms/B/* 一律 404，不触 db ----

describe('Realm Isolation · 路径守卫（/realms/:realmId/*）', () => {
  it('GET /realms/B → 404 且不触 db', async () => {
    const { db } = mockDb()
    const response = await handleGetRealm(apiRequest(`/api/v1/realms/${REALM_B}`), REALM_B)
    expect(response.status).toBe(404)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('GET /realms/B/projects → 404 且不触 db', async () => {
    const { db } = mockDb()
    const response = await handleListProjects(apiRequest(`/api/v1/realms/${REALM_B}/projects`), REALM_B)
    expect(response.status).toBe(404)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('GET /realms/B/threads → 404 且不触 db', async () => {
    const { db } = mockDb()
    const response = await handleListThreads(apiRequest(`/api/v1/realms/${REALM_B}/threads`), REALM_B)
    expect(response.status).toBe(404)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('GET /realms/B/entities → 404 且不触 db', async () => {
    const { db } = mockDb()
    const response = await handleListEntities(apiRequest(`/api/v1/realms/${REALM_B}/entities`), REALM_B)
    expect(response.status).toBe(404)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('GET /realms/B/currents → 404 且不触 db', async () => {
    const { db } = mockDb()
    const response = await handleListCurrents(apiRequest(`/api/v1/realms/${REALM_B}/currents`), REALM_B)
    expect(response.status).toBe(404)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('POST /realms/B/threads → 404（路径守卫先于 body 解析）', async () => {
    const { db } = mockDb()
    const response = await handleCreateThread(
      apiRequest(`/api/v1/realms/${REALM_B}/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_id: PROJECT_B, title: 'cross' }),
      }),
      REALM_B,
    )
    expect(response.status).toBe(404)
    expect(db.select).not.toHaveBeenCalled()
  })
})

// ---- 资源守卫：/threads/<B-thread> 跨 Realm → 404 ----

describe('Realm Isolation · 资源守卫（/threads/:threadId）', () => {
  it('GET /threads/<B-thread> → 404（requireThreadRow 按 realmId 过滤）', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handleGetThread(apiRequest(`/api/v1/threads/${THREAD_B}`), THREAD_B)
    expect(response.status).toBe(404)
    const body = await readJson<ErrorBody>(response)
    expect(body.error.code).toBe('not_found')
  })

  it('PATCH /threads/<B-thread> → 404', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handlePatchThread(
      apiRequest(`/api/v1/threads/${THREAD_B}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      }),
      THREAD_B,
    )
    expect(response.status).toBe(404)
  })

  it('GET /threads/<B-thread>/dialogues → 404', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handleListDialogues(apiRequest(`/api/v1/threads/${THREAD_B}/dialogues`), THREAD_B)
    expect(response.status).toBe(404)
  })

  it('POST /threads/<B-thread>/dialogues → 404', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handleCreateDialogue(
      apiRequest(`/api/v1/threads/${THREAD_B}/dialogues`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'cross-realm message' }),
      }),
      THREAD_B,
    )
    expect(response.status).toBe(404)
  })
})

// ---- 列表隔离：令牌 A 列表仅含 A 的行 ----

describe('Realm Isolation · 列表隔离', () => {
  it('GET /realms/A/threads 仅返回 A 的 Thread（B 的行不泄露）', async () => {
    mockDb({
      dbSelectResults: [
        [{ total: 1 }],
        [threadRow(REALM_A, THREAD_A, PROJECT_A)],
      ],
    })
    const response = await handleListThreads(apiRequest(`/api/v1/realms/${REALM_A}/threads`), REALM_A)
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.id).toBe(THREAD_A)
    expect(body.data[0]?.realm_id).toBe(REALM_A)
  })

  it('GET /realms/A/projects 仅返回 A 的 Project', async () => {
    mockDb({
      dbSelectResults: [[projectRow(REALM_A, PROJECT_A)]],
    })
    const response = await handleListProjects(apiRequest(`/api/v1/realms/${REALM_A}/projects`), REALM_A)
    expect(response.status).toBe(200)
    const body = await readJson<ListBody>(response)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.id).toBe(PROJECT_A)
  })
})

// ---- 写隔离：A 令牌引用 B 的 project_id → 400 invalid_project ----

describe('Realm Isolation · 写隔离', () => {
  it('POST /realms/A/threads 引用 B 的 project_id → 400 invalid_project', async () => {
    mockDb({
      dbSelectResults: [[]],
      txInsertResults: [[threadRow(REALM_A, THREAD_A, PROJECT_A)]],
    })
    const response = await handleCreateThread(
      apiRequest(`/api/v1/realms/${REALM_A}/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_id: PROJECT_B, title: 'steal project' }),
      }),
      REALM_A,
    )
    expect(response.status).toBe(400)
    const body = await readJson<ErrorBody>(response)
    expect(body.error.code).toBe('bad_request')
  })
})

// ---- 同 Realm 正向回归：A 令牌正常访问 A 资源 ----

describe('Realm Isolation · 同 Realm 正向回归', () => {
  it('GET /realms/A → 200', async () => {
    mockDb()
    const response = await handleGetRealm(apiRequest(`/api/v1/realms/${REALM_A}`), REALM_A)
    expect(response.status).toBe(200)
    const body = await readJson<{ id: string }>(response)
    expect(body.id).toBe(REALM_A)
  })

  it('GET /threads/<A-thread> → 200', async () => {
    mockDb({
      dbSelectResults: [[threadRow(REALM_A, THREAD_A, PROJECT_A)]],
    })
    const response = await handleGetThread(apiRequest(`/api/v1/threads/${THREAD_A}`), THREAD_A)
    expect(response.status).toBe(200)
    const body = await readJson<{ id: string; realm_id: string }>(response)
    expect(body.id).toBe(THREAD_A)
    expect(body.realm_id).toBe(REALM_A)
  })

  it('PATCH /threads/<A-thread> 合法迁移 → 200', async () => {
    mockDb({
      dbSelectResults: [[threadRow(REALM_A, THREAD_A, PROJECT_A)]],
      txUpdateResults: [[threadRow(REALM_A, THREAD_A, PROJECT_A)]],
    })
    const response = await handlePatchThread(
      apiRequest(`/api/v1/threads/${THREAD_A}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'in_review' }),
      }),
      THREAD_A,
    )
    expect(response.status).toBe(200)
  })
})
