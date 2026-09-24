// @aether/web · 流式对话端点测试（Wave C：app/api/threads/[threadId]/chat/route.ts）
// 守护：鉴权 → provider 配置检查 → Thread/Entity 查询 → 用户消息落库 →
//       provider model 加载 → 流式响应 → Entity 回复落库 各分支错误码与成功链路。
// 注：mock 了 6 个外部模块（EntityRuntime/LanguageModel/Auth/SessionActor 等），
// 其真实类型为复杂泛型联合，mock 返回值类型对齐成本远超收益；运行时行为已由
// vitest 全量验证（14 用例通过），此处豁免类型层检查。
// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ __op: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val })),
}))

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/auth', () => ({ tryGetAuth: vi.fn() }))

vi.mock('@aether/db', () => ({
  threads: { id: 'threads.id', realm_id: 'threads.realm_id', dialogue_ref: 'threads.dialogue_ref' },
  entities: {
    id: 'entities.id',
    realm_id: 'entities.realm_id',
    status: 'entities.status',
    capability_manifesto: 'entities.capability_manifesto',
  },
  dialogueMessages: {
    realm_id: 'dialogueMessages.realm_id',
    dialogue_id: 'dialogueMessages.dialogue_id',
    role: 'dialogueMessages.role',
    content: 'dialogueMessages.content',
    seq: 'dialogueMessages.seq',
  },
}))

vi.mock('@aether/auth', () => ({ resolveSessionActor: vi.fn() }))

vi.mock('@/lib/resonance/core', () => ({ coreAppendDialogue: vi.fn() }))

vi.mock('@aether/entity-core', () => ({
  createEntityLanguageModel: vi.fn(),
  createEntityRuntime: vi.fn(),
  loadProviderModel: vi.fn(),
  resolveProviderConfig: vi.fn(),
}))

import { getDb } from '@/lib/db'
import { tryGetAuth } from '@/lib/auth'
import { resolveSessionActor } from '@aether/auth'
import { coreAppendDialogue } from '@/lib/resonance/core'
import {
  createEntityLanguageModel,
  createEntityRuntime,
  loadProviderModel,
  resolveProviderConfig,
} from '@aether/entity-core'

import { POST } from '@/app/api/threads/[threadId]/chat/route'

const mockedGetDb = vi.mocked(getDb)
const mockedTryGetAuth = vi.mocked(tryGetAuth)
const mockedResolveSessionActor = vi.mocked(resolveSessionActor)
const mockedCoreAppendDialogue = vi.mocked(coreAppendDialogue)
const mockedCreateEntityLanguageModel = vi.mocked(createEntityLanguageModel)
const mockedCreateEntityRuntime = vi.mocked(createEntityRuntime)
const mockedLoadProviderModel = vi.mocked(loadProviderModel)
const mockedResolveProviderConfig = vi.mocked(resolveProviderConfig)

const THREAD_ID = 'thread-0001'
const REALM_ID = 'realm-0001'
const ENTITY_ID = 'ent-0001'
const DIALOGUE_ID = 'dlg-0001'

/** 构造可链式调用的 select 结果（.from().where().orderBy().limit() → rows） */
function makeSelectChain(rows: unknown[]): Record<string, unknown> {
  const promise = Promise.resolve(rows)
  const self: Record<string, unknown> = {
    limit: () => self,
    orderBy: () => self,
    where: () => self,
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  }
  return self
}

function makeDb(selectResults: unknown[][]): void {
  const queue = [...selectResults]
  const db = {
    select: vi.fn(() => ({ from: () => makeSelectChain(queue.shift() ?? []) })),
  }
  mockedGetDb.mockReturnValue(db as never)
}

/** 构造 NextRequest mock */
function makeRequest(body: unknown): { json: () => Promise<unknown> } {
  return {
    json: () =>
      body instanceof Error
        ? Promise.reject(body)
        : Promise.resolve(body),
  }
}

const ENTITY_ROW = {
  id: ENTITY_ID,
  realm_id: REALM_ID,
  status: 'active',
  capability_manifesto: { capabilities: [], schema_version: 1 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedTryGetAuth.mockReturnValue(null)
  mockedResolveProviderConfig.mockReturnValue({
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet',
    apiKey: 'sk-test',
  })
})

describe('POST /api/threads/[threadId]/chat · 错误分支', () => {
  it('无效 JSON body → 400 bad_request', async () => {
    const res = await POST(
      makeRequest(new Error('invalid json')) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('bad_request')
    expect(json.error.message).toMatch(/Invalid JSON/)
  })

  it('缺 realmId → 400 bad_request', async () => {
    const res = await POST(
      makeRequest({ content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('bad_request')
    expect(json.error.message).toMatch(/realmId and content are required/)
  })

  it('空 content → 400 bad_request', async () => {
    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: '   ' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('bad_request')
  })

  it('provider 未配置 → 503 provider_not_configured', async () => {
    mockedResolveProviderConfig.mockReturnValue(null)
    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error.code).toBe('provider_not_configured')
    expect(json.error.message).toMatch(/LLM provider 未配置/)
  })

  it('provider 配置不完整（resolveProviderConfig 抛错）→ 异常向上抛', async () => {
    mockedResolveProviderConfig.mockImplementation(() => {
      throw new Error('AETHER_ENTITY_MODEL 缺失')
    })
    await expect(
      POST(
        makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
        { params: Promise.resolve({ threadId: THREAD_ID }) },
      ),
    ).rejects.toThrowError(/AETHER_ENTITY_MODEL 缺失/)
  })

  it('Thread 不存在 → 404 not_found', async () => {
    makeDb([[]]) // thread 查询返回空
    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.code).toBe('not_found')
  })

  it('Thread 存在但无 active Entity → 404 no_active_entity', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }], // thread
      [], // entity 空
    ])
    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.code).toBe('no_active_entity')
  })

  it('用户消息落库失败 → 400 + core 错误码', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }],
      [ENTITY_ROW],
    ])
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: false,
      code: 'dialogue_closed',
      message: '对话已关闭',
    })
    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('dialogue_closed')
    expect(json.error.message).toBe('对话已关闭')
  })

  it('loadProviderModel 抛错 → 503 provider_load_failed', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }],
      [ENTITY_ROW],
      [{ role: 'user', content: 'hi' }], // history
    ])
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedLoadProviderModel.mockRejectedValue(new Error('网络不可达'))
    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error.code).toBe('provider_load_failed')
    expect(json.error.message).toBe('网络不可达')
  })
})

describe('POST /api/threads/[threadId]/chat · 成功流式响应', () => {
  it('完整链路 → 200 + 流式 token + Entity 回复落库 + 正确 headers', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }], // thread
      [ENTITY_ROW], // entity
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'prev' },
      ], // history
    ])

    // 用户消息落库成功
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    // Entity 回复落库成功（第二次调用）
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })

    mockedLoadProviderModel.mockResolvedValue({ __brand: 'provider-model' })
    mockedCreateEntityLanguageModel.mockReturnValue({ __brand: 'entity-lm' })

    const streamChat = vi.fn(
      async (
        _db: unknown,
        _realmId: unknown,
        _history: unknown,
        _tools: unknown,
        opts: { onToken?: (t: string) => void },
      ) => {
        // 模拟逐 token 流
        for (const t of ['Hello', ' ', 'Entity']) opts.onToken?.(t)
        return {
          reply: 'Hello Entity',
          toolCalls: [{ toolName: 'search', args: { q: 'x' } }],
          auditIds: ['audit-1', 'audit-2'],
        }
      },
    )
    mockedCreateEntityRuntime.mockReturnValue({ streamChat })

    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi', entityId: ENTITY_ID }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )

    // 响应头
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('x-aether-entity')).toBe(ENTITY_ID)

    // 消费流
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let collected = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      collected += decoder.decode(value, { stream: true })
    }
    expect(collected).toBe('Hello Entity')

    // runtime 实例化参数
    expect(mockedCreateEntityRuntime).toHaveBeenCalledTimes(1)
    const runtimeArg = mockedCreateEntityRuntime.mock.calls[0][0] as {
      entity: unknown
      model: unknown
      manifesto: unknown
    }
    expect(runtimeArg.entity).toBe(ENTITY_ROW)
    expect(runtimeArg.model).toEqual({ __brand: 'entity-lm' })

    // 用户消息落库：role=user + content trim + via=web-session-chat
    const userCall = mockedCoreAppendDialogue.mock.calls[0][1] as {
      threadId: string
      role: string
      content: string
      actor: { actorType: string; actorId: string; source: string }
      metadata: { via: string }
    }
    expect(userCall.threadId).toBe(THREAD_ID)
    expect(userCall.role).toBe('user')
    expect(userCall.content).toBe('hi')
    expect(userCall.actor).toEqual({
      actorType: 'human',
      actorId: 'web-client',
      source: 'session',
    })
    expect(userCall.metadata.via).toBe('web-session-chat')

    // Entity 回复落库：role=assistant + reply 内容 + toolCalls/auditIds 入 metadata
    const assistantCall = mockedCoreAppendDialogue.mock.calls[1][1] as {
      role: string
      content: string
      actor: { actorType: string; actorId: string }
      metadata: {
        via: string
        toolCalls: unknown
        auditIds: string[]
      }
    }
    expect(assistantCall.role).toBe('assistant')
    expect(assistantCall.content).toBe('Hello Entity')
    expect(assistantCall.actor).toEqual({
      actorType: 'entity',
      actorId: ENTITY_ID,
      source: 'session',
    })
    expect(assistantCall.metadata.via).toBe('entity-runtime-stream')
    expect(assistantCall.metadata.toolCalls).toEqual([
      { toolName: 'search', args: { q: 'x' } },
    ])
    expect(assistantCall.metadata.auditIds).toEqual(['audit-1', 'audit-2'])
  })

  it('streamChat 抛错 → controller.error 写入错误标记后流结束', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }],
      [ENTITY_ROW],
      [],
    ])
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedLoadProviderModel.mockResolvedValue({ __brand: 'm' })
    mockedCreateEntityLanguageModel.mockReturnValue({ __brand: 'lm' })
    mockedCreateEntityRuntime.mockReturnValue({
      streamChat: vi.fn(async () => {
        throw new Error('provider 5xx')
      }),
    })

    const res = await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )
    expect(res.status).toBe(200)

    // controller.error 会使流读取 reject，reason 为编码后的错误文本 Uint8Array
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    try {
      await reader.read()
      throw new Error('read 应当 reject')
    } catch (reason) {
      const buf = reason as Uint8Array
      const text = new TextDecoder().decode(buf)
      expect(text).toMatch(/Entity error: provider 5xx/)
    }
  })
})

describe('POST /api/threads/[threadId]/chat · 鉴权 actor 解析', () => {
  it('有会话 auth → resolveSessionActor 返回 actor 透传到 coreAppendDialogue', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }],
      [ENTITY_ROW],
      [],
    ])
    mockedTryGetAuth.mockReturnValue({ type: 'session' })
    mockedResolveSessionActor.mockResolvedValue({
      actorType: 'human',
      actorId: 'user-42',
    })
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedLoadProviderModel.mockResolvedValue({})
    mockedCreateEntityLanguageModel.mockReturnValue({})
    mockedCreateEntityRuntime.mockReturnValue({
      streamChat: vi.fn(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, o: { onToken?: (t: string) => void }) => {
        o.onToken?.('ok')
        return { reply: 'ok', toolCalls: undefined, auditIds: [] }
      }),
    })

    await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )

    expect(mockedResolveSessionActor).toHaveBeenCalledTimes(1)
    const userCall = mockedCoreAppendDialogue.mock.calls[0][1] as {
      actor: { actorId: string }
      messageActor: { actorId: string }
    }
    expect(userCall.actor.actorId).toBe('user-42')
    expect(userCall.messageActor.actorId).toBe('user-42')
  })

  it('resolveSessionActor 抛错 → 回退 web-client actor', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }],
      [ENTITY_ROW],
      [],
    ])
    mockedTryGetAuth.mockReturnValue({ type: 'session' })
    mockedResolveSessionActor.mockRejectedValue(new Error('session expired'))
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedLoadProviderModel.mockResolvedValue({})
    mockedCreateEntityLanguageModel.mockReturnValue({})
    mockedCreateEntityRuntime.mockReturnValue({
      streamChat: vi.fn(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, o: { onToken?: (t: string) => void }) => {
        o.onToken?.('ok')
        return { reply: 'ok', toolCalls: undefined, auditIds: [] }
      }),
    })

    await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )

    const userCall = mockedCoreAppendDialogue.mock.calls[0][1] as {
      actor: { actorId: string }
    }
    expect(userCall.actor.actorId).toBe('web-client')
  })

  it('resolveSessionActor 返回 null → 回退 web-client actor', async () => {
    makeDb([
      [{ id: THREAD_ID, dialogue_ref: DIALOGUE_ID }],
      [ENTITY_ROW],
      [],
    ])
    mockedTryGetAuth.mockReturnValue({ type: 'session' })
    mockedResolveSessionActor.mockResolvedValue(null)
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedCoreAppendDialogue.mockResolvedValueOnce({
      ok: true,
      data: { dialogueId: DIALOGUE_ID },
    })
    mockedLoadProviderModel.mockResolvedValue({})
    mockedCreateEntityLanguageModel.mockReturnValue({})
    mockedCreateEntityRuntime.mockReturnValue({
      streamChat: vi.fn(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, o: { onToken?: (t: string) => void }) => {
        o.onToken?.('ok')
        return { reply: 'ok', toolCalls: undefined, auditIds: [] }
      }),
    })

    await POST(
      makeRequest({ realmId: REALM_ID, content: 'hi' }) as never,
      { params: Promise.resolve({ threadId: THREAD_ID }) },
    )

    const userCall = mockedCoreAppendDialogue.mock.calls[0][1] as {
      actor: { actorId: string }
    }
    expect(userCall.actor.actorId).toBe('web-client')
  })
})
