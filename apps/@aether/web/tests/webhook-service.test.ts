// Webhook Constellation 服务层测试（lib/webhooks/service.ts）
// 覆盖：outbox 入队（匹配订阅 / 信封 / 零订阅零写入）、订阅 CRUD
// （跨 Realm 404 / 503 fail-closed / 明文 secret 仅创建时返回一次）、
// dispatch 端点鉴权（恒时比较 / 未配置 503）、投递扫描
// （成功 / 重试退避 / 耗尽 / 取消 / 解密失败 / 网络错误 / 签名头可验证）。
import { randomBytes } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

// 纯函数（requireRealmMatch / apiKeyActor）取实际实现；
// authorizeRequest 用 mock 注入固定 API Key 上下文。
vi.mock('@/lib/resonance/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof resonanceAuth>()
  return {
    ...actual,
    authorizeRequest: vi.fn(),
  }
})

vi.mock('@/lib/github', () => ({
  getIntegrationEncryptionKey: vi.fn(),
}))

vi.mock('@/lib/audit-write', () => ({
  recordAuditEntry: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { getDb } from '@/lib/db'
import { authorizeRequest } from '@/lib/resonance/auth'
import type * as resonanceAuth from '@/lib/resonance/auth'
import { getIntegrationEncryptionKey } from '@/lib/github'
import { recordAuditEntry } from '@/lib/audit-write'
import {
  encryptSecret,
  importAesKey,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SECRET_PREFIX,
} from '@aether/resonance'
import {
  dispatchPendingWebhooks,
  enqueueWebhookDeliveries,
  handleCreateWebhook,
  handleDeleteWebhook,
  handleListWebhookDeliveries,
  handleListWebhooks,
  verifyDispatchAuthorization,
} from '@/lib/webhooks/service'

const mockedGetDb = vi.mocked(getDb)
const mockedAuthorizeRequest = vi.mocked(authorizeRequest)
const mockedGetEncryptionKey = vi.mocked(getIntegrationEncryptionKey)
const mockedRecordAuditEntry = vi.mocked(recordAuditEntry)

const REALM_ID = '123e4567-e89b-12d3-a456-426614174000'
const OTHER_REALM_ID = '223e4567-e89b-12d3-a456-426614174000'
const SUBSCRIPTION_ID = '323e4567-e89b-12d3-a456-426614174004'
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

// ---- 测试加密密钥（真实 AES-GCM 往返，不 mock @aether/resonance）----

const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const DISPATCH_SECRET = 'whsec_dispatch_test_secret'
let DISPATCH_ENCRYPTED_SECRET = ''

beforeAll(async () => {
  const aesKey = await importAesKey(TEST_ENCRYPTION_KEY)
  DISPATCH_ENCRYPTED_SECRET = await encryptSecret(DISPATCH_SECRET, aesKey)
})

// ---- mock 基建 ----

function apiRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://aether.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  })
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
  txSelectResults?: unknown[][]
  txInsertResults?: unknown[][]
}

interface MockDb {
  db: Record<string, unknown>
  tx: Record<string, unknown>
  /** db.update().set(patch) 捕获的补丁（dispatch finalize 断言用）。 */
  dbUpdatePatches: Array<Record<string, unknown>>
  /** tx.update().set(patch) 捕获的补丁（软删除断言用）。 */
  txUpdatePatches: Array<Record<string, unknown>>
  /** tx.insert().values(v) 捕获的载荷（入队 / 创建订阅断言用）。 */
  txInsertValues: unknown[]
}

function mockDb(config: MockDbConfig = {}): MockDb {
  const dbSelectQueue = queued(config.dbSelectResults ?? [])
  const dbInsertQueue = queued(config.dbInsertResults ?? [])
  const txSelectQueue = queued(config.txSelectResults ?? [])
  const txInsertQueue = queued(config.txInsertResults ?? [])
  const dbUpdatePatches: Array<Record<string, unknown>> = []
  const txUpdatePatches: Array<Record<string, unknown>> = []
  const txInsertValues: unknown[] = []

  const updateWithSink = (sink: Array<Record<string, unknown>>) =>
    vi.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        sink.push(patch)
        return makeChain([])
      },
    }))

  const tx = {
    select: vi.fn(() => ({ from: txSelectQueue })),
    insert: vi.fn(() => ({
      values: (value: unknown) => {
        txInsertValues.push(value)
        return txInsertQueue()
      },
    })),
    update: updateWithSink(txUpdatePatches),
  }
  const db = {
    select: vi.fn(() => ({ from: dbSelectQueue })),
    insert: vi.fn(() => ({ values: dbInsertQueue })),
    update: updateWithSink(dbUpdatePatches),
    delete: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  }
  mockedGetDb.mockReturnValue(db as never)
  return { db, tx, dbUpdatePatches, txUpdatePatches, txInsertValues }
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    realm_id: REALM_ID,
    name: 'CI 通知',
    url: 'https://ci.example.com/hooks/aether',
    events: ['thread.created'],
    secret_prefix: 'whsec_abc12345',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function pendingDeliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '443e4567-e89b-12d3-a456-426614174005',
    attempts: 0,
    event_type: 'thread.created',
    payload: {
      type: 'thread.created',
      created_at: NOW.toISOString(),
      realm: { id: REALM_ID, slug: 'alpha' },
      data: { thread_id: 't-1' },
    },
    subscription_id: SUBSCRIPTION_ID,
    subscription_url: 'https://ci.example.com/hooks/aether',
    subscription_deleted_at: null,
    encrypted_secret: DISPATCH_ENCRYPTED_SECRET,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetEncryptionKey.mockReturnValue(TEST_ENCRYPTION_KEY)
  mockedAuthorizeRequest.mockResolvedValue({ key: KEY })
  mockedRecordAuditEntry.mockResolvedValue()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ---- 事务性 outbox 入队 ----

describe('enqueueWebhookDeliveries', () => {
  it('无匹配订阅 → 零写入（不查 realm、不 insert）', async () => {
    const { tx } = mockDb({ txSelectResults: [[]] })
    await enqueueWebhookDeliveries(tx as never, {
      realmId: REALM_ID,
      eventType: 'thread.created',
      data: { thread_id: 't-1' },
    })
    expect(tx.select).toHaveBeenCalledTimes(1)
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('匹配订阅 → 为每条订阅插入 pending 投递，信封含 realm slug', async () => {
    const { tx, txInsertValues } = mockDb({
      txSelectResults: [
        [{ id: 'sub-1' }, { id: 'sub-2' }],
        [{ slug: 'alpha' }],
      ],
    })
    await enqueueWebhookDeliveries(tx as never, {
      realmId: REALM_ID,
      eventType: 'thread.status_changed',
      data: { thread_id: 't-1', from: 'open', to: 'in_review' },
    })

    expect(txInsertValues).toHaveLength(1)
    const rows = txInsertValues[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.subscription_id)).toEqual(['sub-1', 'sub-2'])
    for (const row of rows) {
      expect(row.realm_id).toBe(REALM_ID)
      expect(row.event_type).toBe('thread.status_changed')
      expect(row.status).toBe('pending')
      expect(row.next_attempt_at).toBeInstanceOf(Date)
      const payload = row.payload as Record<string, unknown>
      expect(payload.type).toBe('thread.status_changed')
      expect(payload.realm).toEqual({ id: REALM_ID, slug: 'alpha' })
      expect(payload.data).toEqual({
        thread_id: 't-1',
        from: 'open',
        to: 'in_review',
      })
      expect(typeof payload.created_at).toBe('string')
    }
  })
})

// ---- 订阅管理 ----

describe('GET /api/v1/realms/{realmId}/webhooks', () => {
  it('返回订阅列表（资源形状，不含 secret）', async () => {
    mockDb({ dbSelectResults: [[subscriptionRow()]] })
    const response = await handleListWebhooks(
      apiRequest(`/api/v1/realms/${REALM_ID}/webhooks`),
      REALM_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<{
      data: Array<Record<string, unknown>>
    }>(response)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toEqual({
      id: SUBSCRIPTION_ID,
      realm_id: REALM_ID,
      name: 'CI 通知',
      url: 'https://ci.example.com/hooks/aether',
      events: ['thread.created'],
      secret_prefix: 'whsec_abc12345',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    })
  })

  it('跨 Realm 路径 → 404（不泄露存在性）', async () => {
    const { db } = mockDb()
    const response = await handleListWebhooks(
      apiRequest(`/api/v1/realms/${OTHER_REALM_ID}/webhooks`),
      OTHER_REALM_ID,
    )
    expect(response.status).toBe(404)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('密钥无效 → 401', async () => {
    mockedAuthorizeRequest.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'unauthorized', message: 'x' } }),
        { status: 401, headers: { 'www-authenticate': 'Bearer' } },
      ),
    )
    const response = await handleListWebhooks(
      apiRequest(`/api/v1/realms/${REALM_ID}/webhooks`),
      REALM_ID,
    )
    expect(response.status).toBe(401)
  })
})

describe('POST /api/v1/realms/{realmId}/webhooks', () => {
  function createRequest(body: unknown): Request {
    return new Request(
      `https://aether.example/api/v1/realms/${REALM_ID}/webhooks`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      },
    )
  }

  it('非法 body（http url / 目录外事件）→ 400', async () => {
    const { db } = mockDb()
    const response = await handleCreateWebhook(
      createRequest({
        name: 'x',
        url: 'http://insecure.example.com',
        events: ['thread.exploded'],
      }),
      REALM_ID,
    )
    expect(response.status).toBe(400)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('加密密钥未配置 → 503 fail-closed', async () => {
    mockedGetEncryptionKey.mockReturnValue(null)
    const { db } = mockDb()
    const response = await handleCreateWebhook(
      createRequest({
        name: 'CI',
        url: 'https://ci.example.com/hooks/aether',
        events: ['thread.created'],
      }),
      REALM_ID,
    )
    expect(response.status).toBe(503)
    const body = await readJson<{ error: { code: string } }>(response)
    expect(body.error.code).toBe('service_unavailable')
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('创建成功 → 201：明文 secret 仅此一次返回，入库为 AES-GCM 密文', async () => {
    const { db, txInsertValues } = mockDb({
      txInsertResults: [[subscriptionRow({ events: ['*'] })]],
    })
    const response = await handleCreateWebhook(
      createRequest({
        name: 'CI',
        url: 'https://ci.example.com/hooks/aether',
        events: ['thread.created', '*'],
      }),
      REALM_ID,
    )
    expect(response.status).toBe(201)
    const body = await readJson<{
      id: string
      secret: string
      secret_prefix: string
      events: string[]
    }>(response)
    expect(body.id).toBe(SUBSCRIPTION_ID)
    expect(body.secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true)
    // 通配符归一化收敛为 ["*"]
    expect(body.events).toEqual(['*'])

    // 入库值：密文 ≠ 明文，creator 归因
    expect(txInsertValues).toHaveLength(1)
    const inserted = txInsertValues[0] as Record<string, unknown>
    expect(inserted.encrypted_secret).not.toBe(body.secret)
    expect(String(inserted.encrypted_secret).length).toBeGreaterThan(0)
    expect(inserted.created_by).toBe('user-1')
    expect(inserted.events).toEqual(['*'])
    expect(inserted.secret_prefix).toBe(body.secret.slice(0, 12))

    expect(db.transaction).toHaveBeenCalled()
    expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'write' }),
    )
    const auditInput = mockedRecordAuditEntry.mock.calls.at(-1)?.[1]
    expect(auditInput?.actor).toEqual({
      actorType: 'entity',
      actorId: 'api-key:key-1',
    })
    expect(auditInput?.target).toMatchObject({
      kind: 'webhook_subscription',
      source: 'api-key',
    })
  })
})

describe('DELETE /api/v1/webhooks/{subscriptionId}', () => {
  it('不存在 / 跨 Realm / 已删除 → 一律 404', async () => {
    mockDb({ dbSelectResults: [[]] })
    const missing = await handleDeleteWebhook(
      apiRequest(`/api/v1/webhooks/${SUBSCRIPTION_ID}`),
      SUBSCRIPTION_ID,
    )
    expect(missing.status).toBe(404)

    mockDb({ dbSelectResults: [[{ id: SUBSCRIPTION_ID, realm_id: OTHER_REALM_ID }]] })
    const crossRealm = await handleDeleteWebhook(
      apiRequest(`/api/v1/webhooks/${SUBSCRIPTION_ID}`),
      SUBSCRIPTION_ID,
    )
    expect(crossRealm.status).toBe(404)
  })

  it('软删除成功 → 204 + 审计', async () => {
    const { db, txUpdatePatches } = mockDb({
      dbSelectResults: [[{ id: SUBSCRIPTION_ID, realm_id: REALM_ID }]],
    })
    const response = await handleDeleteWebhook(
      apiRequest(`/api/v1/webhooks/${SUBSCRIPTION_ID}`),
      SUBSCRIPTION_ID,
    )
    expect(response.status).toBe(204)
    expect(db.transaction).toHaveBeenCalled()
    expect(txUpdatePatches).toHaveLength(1)
    expect(txUpdatePatches[0]?.deleted_at).toBeInstanceOf(Date)
    expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'write' }),
    )
    const auditInput = mockedRecordAuditEntry.mock.calls.at(-1)?.[1]
    expect(auditInput?.target).toMatchObject({ deleted: true })
  })
})

describe('GET /api/v1/webhooks/{subscriptionId}/deliveries', () => {
  it('订阅不存在 → 404', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handleListWebhookDeliveries(
      apiRequest(`/api/v1/webhooks/${SUBSCRIPTION_ID}/deliveries`),
      SUBSCRIPTION_ID,
    )
    expect(response.status).toBe(404)
  })

  it('返回分页投递列表', async () => {
    mockDb({
      dbSelectResults: [
        [{ id: SUBSCRIPTION_ID }],
        [{ total: 1 }],
        [
          {
            id: 'delivery-1',
            subscription_id: SUBSCRIPTION_ID,
            event_type: 'thread.created',
            status: 'succeeded',
            attempts: 1,
            last_response_status: 200,
            last_error: null,
            created_at: NOW,
            delivered_at: NOW,
          },
        ],
      ],
    })
    const response = await handleListWebhookDeliveries(
      apiRequest(`/api/v1/webhooks/${SUBSCRIPTION_ID}/deliveries`),
      SUBSCRIPTION_ID,
    )
    expect(response.status).toBe(200)
    const body = await readJson<{
      data: Array<Record<string, unknown>>
      pagination: Record<string, unknown>
    }>(response)
    expect(body.pagination).toEqual({ total: 1, limit: 30, offset: 0 })
    expect(body.data[0]).toEqual({
      id: 'delivery-1',
      subscription_id: SUBSCRIPTION_ID,
      event_type: 'thread.created',
      status: 'succeeded',
      attempts: 1,
      last_response_status: 200,
      created_at: NOW.toISOString(),
      delivered_at: NOW.toISOString(),
    })
  })
})

// ---- dispatch 端点鉴权 ----

describe('verifyDispatchAuthorization', () => {
  it('未配置 token → unconfigured（fail-closed）', () => {
    vi.stubEnv('AETHER_WEBHOOK_DISPATCH_TOKEN', '')
    expect(verifyDispatchAuthorization('Bearer anything')).toBe('unconfigured')
    expect(verifyDispatchAuthorization(null)).toBe('unconfigured')
  })

  it('正确 Bearer token → ok', () => {
    vi.stubEnv('AETHER_WEBHOOK_DISPATCH_TOKEN', 'cron-secret')
    expect(verifyDispatchAuthorization('Bearer cron-secret')).toBe('ok')
  })

  it('缺失 / 错误 / 长度不符 → unauthorized', () => {
    vi.stubEnv('AETHER_WEBHOOK_DISPATCH_TOKEN', 'cron-secret')
    expect(verifyDispatchAuthorization(null)).toBe('unauthorized')
    expect(verifyDispatchAuthorization('Bearer wrong')).toBe('unauthorized')
    expect(verifyDispatchAuthorization('bearer cron-secret')).toBe(
      'unauthorized',
    )
    expect(verifyDispatchAuthorization('Bearer cron-secret!')).toBe(
      'unauthorized',
    )
  })
})

// ---- Cron 投递扫描 ----

describe('dispatchPendingWebhooks', () => {
  it('加密密钥未配置 → 空转（不查库）', async () => {
    mockedGetEncryptionKey.mockReturnValue(null)
    const { db } = mockDb()
    const summary = await dispatchPendingWebhooks(NOW)
    expect(summary).toEqual({
      claimed: 0,
      succeeded: 0,
      retried: 0,
      exhausted: 0,
      canceled: 0,
    })
    expect(db.select).not.toHaveBeenCalled()
  })

  it('无到期投递 → claimed 0', async () => {
    mockDb({ dbSelectResults: [[]] })
    const summary = await dispatchPendingWebhooks(NOW)
    expect(summary.claimed).toBe(0)
  })

  it('2xx → succeeded：补丁含 delivered_at，请求头签名可用 secret 验证', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { dbUpdatePatches } = mockDb({
      dbSelectResults: [[pendingDeliveryRow()]],
    })

    const summary = await dispatchPendingWebhooks(NOW)

    expect(summary).toEqual({
      claimed: 1,
      succeeded: 1,
      retried: 0,
      exhausted: 0,
      canceled: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ]
    expect(url).toBe('https://ci.example.com/hooks/aether')
    expect(init.method).toBe('POST')
    expect(init.headers['x-aether-delivery']).toBe(
      '443e4567-e89b-12d3-a456-426614174005',
    )
    expect(init.headers['x-aether-event']).toBe('thread.created')
    expect(init.headers['x-aether-hook-id']).toBe(SUBSCRIPTION_ID)
    expect(init.headers['x-aether-timestamp']).toBe(
      String(Math.floor(NOW.getTime() / 1000)),
    )
    // 签名与解密后的 secret + 原始 body 交叉验证
    await expect(
      verifyWebhookSignature(
        DISPATCH_SECRET,
        init.body as string,
        init.headers['x-aether-signature-256'] as string,
      ),
    ).resolves.toBe(true)

    expect(dbUpdatePatches).toHaveLength(1)
    expect(dbUpdatePatches[0]).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      last_response_status: 200,
      last_error: null,
      delivered_at: NOW,
    })
  })

  it('非 2xx → retried：attempts+1，next_attempt_at = now + 30s', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const { dbUpdatePatches } = mockDb({
      dbSelectResults: [[pendingDeliveryRow({ attempts: 0 })]],
    })

    const summary = await dispatchPendingWebhooks(NOW)

    expect(summary.retried).toBe(1)
    expect(summary.exhausted).toBe(0)
    expect(dbUpdatePatches[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_response_status: 500,
      last_error: 'HTTP 500',
    })
    const nextAttempt = dbUpdatePatches[0]?.next_attempt_at as Date
    expect(nextAttempt.getTime()).toBe(NOW.getTime() + 30_000)
  })

  it('达最大尝试次数 → exhausted（不再排下次）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { dbUpdatePatches } = mockDb({
      dbSelectResults: [[pendingDeliveryRow({ attempts: 7 })]],
    })

    const summary = await dispatchPendingWebhooks(NOW)

    expect(summary.exhausted).toBe(1)
    expect(summary.retried).toBe(0)
    expect(dbUpdatePatches[0]).toMatchObject({
      status: 'exhausted',
      attempts: 8,
      last_response_status: 503,
      last_error: 'HTTP 503',
    })
    expect(dbUpdatePatches[0]).not.toHaveProperty('next_attempt_at')
  })

  it('网络错误 / 超时 → retried（last_response_status 为 null）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const { dbUpdatePatches } = mockDb({
      dbSelectResults: [[pendingDeliveryRow()]],
    })

    const summary = await dispatchPendingWebhooks(NOW)

    expect(summary.retried).toBe(1)
    expect(dbUpdatePatches[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_response_status: null,
      last_error: 'network error: ECONNREFUSED',
    })
  })

  it('订阅已删除 → canceled（不发起回调）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { dbUpdatePatches } = mockDb({
      dbSelectResults: [
        [pendingDeliveryRow({ subscription_deleted_at: NOW })],
      ],
    })

    const summary = await dispatchPendingWebhooks(NOW)

    expect(summary.canceled).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbUpdatePatches[0]).toMatchObject({
      status: 'canceled',
      last_error: 'subscription deleted',
    })
  })

  it('secret 解密失败（密钥轮换）→ exhausted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { dbUpdatePatches } = mockDb({
      dbSelectResults: [
        [pendingDeliveryRow({ encrypted_secret: 'AAAA' })],
      ],
    })

    const summary = await dispatchPendingWebhooks(NOW)

    expect(summary.exhausted).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbUpdatePatches[0]).toMatchObject({ status: 'exhausted' })
    expect(String(dbUpdatePatches[0]?.last_error)).toContain(
      'secret decryption failed',
    )
  })

  it('签名头由 signWebhookPayload 生成（与已知向量一致）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const row = pendingDeliveryRow()
    mockDb({ dbSelectResults: [[row]] })

    await dispatchPendingWebhooks(NOW)

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ]
    const expected = await signWebhookPayload(
      DISPATCH_SECRET,
      init.body as string,
    )
    expect(init.headers['x-aether-signature-256']).toBe(expected)
  })
})
