// Webhook 投递跨 Realm 隔离端到端验证（M3.21）
// 验证异步投递链路（入队 → Cron 扫描 → HTTP 出站）的多租户边界：
//   1. 入队隔离：Realm A 事件仅入队到 A 订阅
//   2. 投递隔离：dispatch 仅投递 delivery 到其绑定订阅的 url
//   3. 订阅方查询 / 删除隔离：令牌 A 查 / 删 B 订阅 → 404
// 沿 webhook-service.test.ts 的 mock 范式，真实 AES-GCM 往返 + stubbed fetch，
// 纯单测无 Postgres / 无出站网络。
import { randomBytes } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

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
  verifyWebhookSignature,
} from '@aether/resonance'
import {
  dispatchPendingWebhooks,
  enqueueWebhookDeliveries,
  handleDeleteWebhook,
  handleListWebhookDeliveries,
} from '@/lib/webhooks/service'

const mockedGetDb = vi.mocked(getDb)
const mockedAuthorizeRequest = vi.mocked(authorizeRequest)
const mockedGetEncryptionKey = vi.mocked(getIntegrationEncryptionKey)
const mockedRecordAuditEntry = vi.mocked(recordAuditEntry)

// ---- 双 Realm 固件 ----

const REALM_A = '11111111-1111-1111-1111-111111111111'
const REALM_B = '22222222-2222-2222-2222-222222222222'
const SUB_A = '33333333-3333-3333-3333-333333333333'
const SUB_B = '44444444-4444-4444-4444-444444444444'
const DELIVERY_A = '55555555-5555-5555-5555-555555555555'
const DELIVERY_B = '66666666-6666-6666-6666-666666666666'
const URL_A = 'https://ci-a.example.com/hooks/aether'
const URL_B = 'https://ci-b.example.com/hooks/aether'
const NOW = new Date('2026-09-05T00:00:00.000Z')
const TOKEN_A = `aeth_${'a'.repeat(40)}`

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

// ---- 真实 AES-GCM 往返：双订阅各自 secret ----

const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const SECRET_A = 'whsec_realm_a_secret_value_aaaaaa'
const SECRET_B = 'whsec_realm_b_secret_value_bbbbbb'
let ENCRYPTED_SECRET_A = ''
let ENCRYPTED_SECRET_B = ''

beforeAll(async () => {
  const aesKey = await importAesKey(TEST_ENCRYPTION_KEY)
  ENCRYPTED_SECRET_A = await encryptSecret(SECRET_A, aesKey)
  ENCRYPTED_SECRET_B = await encryptSecret(SECRET_B, aesKey)
})

// ---- mock 基建 ----

function apiRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://aether.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN_A}`,
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
  dbUpdatePatches: Array<Record<string, unknown>>
  txInsertValues: unknown[]
}

function mockDb(config: MockDbConfig = {}): MockDb {
  const dbSelectQueue = queued(config.dbSelectResults ?? [])
  const dbInsertQueue = queued(config.dbInsertResults ?? [])
  const txSelectQueue = queued(config.txSelectResults ?? [])
  const txInsertQueue = queued(config.txInsertResults ?? [])
  const dbUpdatePatches: Array<Record<string, unknown>> = []
  const txInsertValues: unknown[] = []

  const db = {
    select: vi.fn(() => ({ from: dbSelectQueue })),
    insert: vi.fn(() => ({ values: dbInsertQueue })),
    update: vi.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        dbUpdatePatches.push(patch)
        return makeChain([])
      },
    })),
    delete: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  }
  const tx = {
    select: vi.fn(() => ({ from: txSelectQueue })),
    insert: vi.fn(() => ({
      values: (value: unknown) => {
        txInsertValues.push(value)
        return txInsertQueue()
      },
    })),
    update: vi.fn(() => ({ set: vi.fn(() => makeChain([])) })),
  }
  mockedGetDb.mockReturnValue(db as never)
  return { db, tx, dbUpdatePatches, txInsertValues }
}

/** pending delivery 行（dispatch 扫描输入，JOIN subscription 字段）。 */
function pendingDeliveryRow(
  realmId: string,
  deliveryId: string,
  subscriptionId: string,
  url: string,
  encryptedSecret: string,
): Record<string, unknown> {
  return {
    id: deliveryId,
    attempts: 0,
    event_type: 'thread.created',
    payload: {
      type: 'thread.created',
      created_at: NOW.toISOString(),
      realm: { id: realmId, slug: realmId === REALM_A ? 'alpha' : 'beta' },
      data: { thread_id: `t-${realmId.slice(0, 4)}` },
    },
    subscription_id: subscriptionId,
    subscription_url: url,
    subscription_deleted_at: null,
    encrypted_secret: encryptedSecret,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetEncryptionKey.mockReturnValue(TEST_ENCRYPTION_KEY)
  mockedAuthorizeRequest.mockResolvedValue({ key: KEY_A })
  mockedRecordAuditEntry.mockResolvedValue()
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ---- 入队隔离 ----

describe('Webhook Realm Isolation · 入队（enqueueWebhookDeliveries）', () => {
  it('Realm A 事件仅入队到 A 订阅，B 订阅无 delivery', async () => {
    const { tx, txInsertValues } = mockDb({
      txSelectResults: [
        [{ id: SUB_A }],
        [{ slug: 'alpha' }],
      ],
    })
    await enqueueWebhookDeliveries(tx as never, {
      realmId: REALM_A,
      eventType: 'thread.created',
      data: { thread_id: 't-a' },
    })
    expect(txInsertValues).toHaveLength(1)
    const rows = txInsertValues[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.subscription_id).toBe(SUB_A)
    expect(rows[0]?.realm_id).toBe(REALM_A)
  })

  it('Realm B 事件仅入队到 B 订阅，A 订阅无 delivery', async () => {
    const { tx, txInsertValues } = mockDb({
      txSelectResults: [
        [{ id: SUB_B }],
        [{ slug: 'beta' }],
      ],
    })
    await enqueueWebhookDeliveries(tx as never, {
      realmId: REALM_B,
      eventType: 'thread.created',
      data: { thread_id: 't-b' },
    })
    expect(txInsertValues).toHaveLength(1)
    const rows = txInsertValues[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.subscription_id).toBe(SUB_B)
    expect(rows[0]?.realm_id).toBe(REALM_B)
  })

  it('A 事件入队的 delivery 信封 realm.id = A（与订阅 realm 一致）', async () => {
    const { tx, txInsertValues } = mockDb({
      txSelectResults: [
        [{ id: SUB_A }],
        [{ slug: 'alpha' }],
      ],
    })
    await enqueueWebhookDeliveries(tx as never, {
      realmId: REALM_A,
      eventType: 'thread.status_changed',
      data: { thread_id: 't-a', from: 'open', to: 'in_review' },
    })
    const rows = txInsertValues[0] as Array<Record<string, unknown>>
    const payload = rows[0]?.payload as Record<string, unknown>
    expect(payload.realm).toEqual({ id: REALM_A, slug: 'alpha' })
    expect(payload.type).toBe('thread.status_changed')
  })
})

// ---- 投递隔离 ----

describe('Webhook Realm Isolation · 投递（dispatchPendingWebhooks）', () => {
  it('双 Realm 各一条 delivery → fetch 仅命中各自订阅 url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mockDb({
      dbSelectResults: [
        [
          pendingDeliveryRow(REALM_A, DELIVERY_A, SUB_A, URL_A, ENCRYPTED_SECRET_A),
          pendingDeliveryRow(REALM_B, DELIVERY_B, SUB_B, URL_B, ENCRYPTED_SECRET_B),
        ],
      ],
    })

    const summary = await dispatchPendingWebhooks(NOW)

    expect(summary).toEqual({
      claimed: 2,
      succeeded: 2,
      retried: 0,
      exhausted: 0,
      canceled: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map(([url]) => url as string)
    expect(urls).toContain(URL_A)
    expect(urls).toContain(URL_B)
    // A delivery 不到 urlB，B delivery 不到 urlA
    expect(urls).not.toEqual([URL_A, URL_A])
    expect(urls).not.toEqual([URL_B, URL_B])
  })

  it('各 delivery 的 POST body payload.realm.id 与订阅 realm 一致', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mockDb({
      dbSelectResults: [
        [
          pendingDeliveryRow(REALM_A, DELIVERY_A, SUB_A, URL_A, ENCRYPTED_SECRET_A),
          pendingDeliveryRow(REALM_B, DELIVERY_B, SUB_B, URL_B, ENCRYPTED_SECRET_B),
        ],
      ],
    })

    await dispatchPendingWebhooks(NOW)

    const callsByRealm = new Map<string, string>()
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit & { body: string }]
      const body = JSON.parse(init.body as string) as {
        realm: { id: string }
      }
      callsByRealm.set(body.realm.id, (call[0] as string))
    }
    expect(callsByRealm.get(REALM_A)).toBe(URL_A)
    expect(callsByRealm.get(REALM_B)).toBe(URL_B)
  })

  it('签名由各自订阅 secret 生成（互不串用）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mockDb({
      dbSelectResults: [
        [
          pendingDeliveryRow(REALM_A, DELIVERY_A, SUB_A, URL_A, ENCRYPTED_SECRET_A),
          pendingDeliveryRow(REALM_B, DELIVERY_B, SUB_B, URL_B, ENCRYPTED_SECRET_B),
        ],
      ],
    })

    await dispatchPendingWebhooks(NOW)

    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as [
        string,
        RequestInit & { headers: Record<string, string>; body: string },
      ]
      const secret = url === URL_A ? SECRET_A : SECRET_B
      await expect(
        verifyWebhookSignature(
          secret,
          init.body as string,
          init.headers['x-aether-signature-256'] as string,
        ),
      ).resolves.toBe(true)
      // 串用另一订阅 secret 必失败
      const wrongSecret = url === URL_A ? SECRET_B : SECRET_A
      await expect(
        verifyWebhookSignature(
          wrongSecret,
          init.body as string,
          init.headers['x-aether-signature-256'] as string,
        ),
      ).resolves.toBe(false)
    }
  })
})

// ---- 订阅方查询 / 删除隔离 ----

describe('Webhook Realm Isolation · 订阅方查询 / 删除', () => {
  it('令牌 A 查 B 订阅 deliveries → 404', async () => {
    mockDb({ dbSelectResults: [[]] })
    const response = await handleListWebhookDeliveries(
      apiRequest(`/api/v1/webhooks/${SUB_B}/deliveries`),
      SUB_B,
    )
    expect(response.status).toBe(404)
  })

  it('令牌 A 删 B 订阅 → 404', async () => {
    mockDb({
      dbSelectResults: [[{ id: SUB_B, realm_id: REALM_B }]],
    })
    const response = await handleDeleteWebhook(
      apiRequest(`/api/v1/webhooks/${SUB_B}`),
      SUB_B,
    )
    expect(response.status).toBe(404)
  })
})

// ---- 同 Realm 正向回归 ----

describe('Webhook Realm Isolation · 同 Realm 正向回归', () => {
  it('Realm A 事件入队 → dispatch 投递到 urlA 成功', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { dbUpdatePatches } = mockDb({
      dbSelectResults: [
        [pendingDeliveryRow(REALM_A, DELIVERY_A, SUB_A, URL_A, ENCRYPTED_SECRET_A)],
      ],
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe(URL_A)
    expect(dbUpdatePatches[0]).toMatchObject({
      status: 'succeeded',
      delivered_at: NOW,
    })
  })

  it('令牌 A 查 A 订阅 deliveries → 200', async () => {
    mockDb({
      dbSelectResults: [
        [{ id: SUB_A }],
        [{ total: 1 }],
        [
          {
            id: DELIVERY_A,
            subscription_id: SUB_A,
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
      apiRequest(`/api/v1/webhooks/${SUB_A}/deliveries`),
      SUB_A,
    )
    expect(response.status).toBe(200)
    const body = await readJson<{
      data: Array<Record<string, unknown>>
      pagination: Record<string, unknown>
    }>(response)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.id).toBe(DELIVERY_A)
  })
})
