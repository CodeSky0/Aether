// @aether/entity-core · LLM Provider 适配层单元测试
// 覆盖 resolveProviderConfig / loadProviderModel / createEntityLanguageModel
// 守护 Wave C provider 适配：环境变量解析、动态加载、消息/工具双向转换、流式接口。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock provider SDK 包：避免真实网络，验证适配层调用契约
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => {
    const modelFn = vi.fn((modelId: string) => ({ __brand: 'anthropic-model', modelId }))
    return modelFn
  }),
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const modelFn = vi.fn((modelId: string) => ({ __brand: 'openai-model', modelId }))
    return modelFn
  }),
}))
vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn(() => {
    const modelFn = vi.fn((modelId: string) => ({ __brand: 'xai-model', modelId }))
    return modelFn
  }),
}))

// mock `ai` 包的 generateText / streamText，验证适配层转换逻辑
const mockGenerateText = vi.fn()
const mockStreamText = vi.fn()
vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
}))

import {
  resolveProviderConfig,
  loadProviderModel,
  createEntityLanguageModel,
  type ProviderConfig,
} from '../src/provider.js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createXai } from '@ai-sdk/xai'

const mockedCreateAnthropic = vi.mocked(createAnthropic)
const mockedCreateOpenAI = vi.mocked(createOpenAI)
const mockedCreateXai = vi.mocked(createXai)

const ENV_BACKUP = { ...process.env }

beforeEach(() => {
  // 每个用例前清空 provider 相关环境变量
  delete process.env['AETHER_ENTITY_PROVIDER']
  delete process.env['AETHER_ENTITY_MODEL']
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['OPENAI_API_KEY']
  delete process.env['XAI_API_KEY']
  vi.clearAllMocks()
})

afterEach(() => {
  // 恢复环境变量
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BACKUP)) delete process.env[k]
  }
  Object.assign(process.env, ENV_BACKUP)
})

describe('resolveProviderConfig', () => {
  it('未配置 AETHER_ENTITY_PROVIDER 时返回 null（向后兼容）', () => {
    expect(resolveProviderConfig()).toBeNull()
  })

  it('配置 provider 但缺 model 时抛错', () => {
    process.env['AETHER_ENTITY_PROVIDER'] = 'anthropic'
    process.env['ANTHROPIC_API_KEY'] = 'sk-test'
    expect(() => resolveProviderConfig()).toThrowError(
      /AETHER_ENTITY_MODEL 缺失/,
    )
  })

  it('配置 provider + model 但缺 API Key 时抛错', () => {
    process.env['AETHER_ENTITY_PROVIDER'] = 'openai'
    process.env['AETHER_ENTITY_MODEL'] = 'gpt-4o'
    expect(() => resolveProviderConfig()).toThrowError(/API Key 环境变量缺失/)
  })

  it('anthropic 完整配置返回 ProviderConfig', () => {
    process.env['AETHER_ENTITY_PROVIDER'] = 'anthropic'
    process.env['AETHER_ENTITY_MODEL'] = 'claude-3-5-sonnet'
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const config = resolveProviderConfig()
    expect(config).toEqual({
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      apiKey: 'sk-ant-test',
    })
  })

  it('openai 完整配置读取 OPENAI_API_KEY', () => {
    process.env['AETHER_ENTITY_PROVIDER'] = 'openai'
    process.env['AETHER_ENTITY_MODEL'] = 'gpt-4o'
    process.env['OPENAI_API_KEY'] = 'sk-oai-test'
    expect(resolveProviderConfig()).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
      apiKey: 'sk-oai-test',
    })
  })

  it('xai 完整配置读取 XAI_API_KEY', () => {
    process.env['AETHER_ENTITY_PROVIDER'] = 'xai'
    process.env['AETHER_ENTITY_MODEL'] = 'grok-4'
    process.env['XAI_API_KEY'] = 'sk-xai-test'
    expect(resolveProviderConfig()).toEqual({
      provider: 'xai',
      modelId: 'grok-4',
      apiKey: 'sk-xai-test',
    })
  })

  it('未知 provider 缺 API Key 时抛错（resolveApiKey 返回 undefined）', () => {
    process.env['AETHER_ENTITY_PROVIDER'] = 'unknown-vendor'
    process.env['AETHER_ENTITY_MODEL'] = 'some-model'
    expect(() => resolveProviderConfig()).toThrowError(/API Key 环境变量缺失/)
  })
})

describe('loadProviderModel', () => {
  it('anthropic 调用 createAnthropic 并以 modelId 实例化', async () => {
    const config: ProviderConfig = {
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      apiKey: 'sk-ant',
    }
    const model = await loadProviderModel(config)
    expect(mockedCreateAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-ant' })
    expect(model).toEqual({
      __brand: 'anthropic-model',
      modelId: 'claude-3-5-sonnet',
    })
  })

  it('openai 调用 createOpenAI 并以 modelId 实例化', async () => {
    const config: ProviderConfig = {
      provider: 'openai',
      modelId: 'gpt-4o',
      apiKey: 'sk-oai',
    }
    const model = await loadProviderModel(config)
    expect(mockedCreateOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-oai' })
    expect(model).toEqual({ __brand: 'openai-model', modelId: 'gpt-4o' })
  })

  it('xai 调用 createXai 并以 modelId 实例化', async () => {
    const config: ProviderConfig = {
      provider: 'xai',
      modelId: 'grok-4',
      apiKey: 'sk-xai',
    }
    const model = await loadProviderModel(config)
    expect(mockedCreateXai).toHaveBeenCalledWith({ apiKey: 'sk-xai' })
    expect(model).toEqual({ __brand: 'xai-model', modelId: 'grok-4' })
  })

  it('未知 provider 抛清晰错误', async () => {
    const config = {
      provider: 'mistral' as unknown as 'anthropic',
      modelId: 'mistral-large',
      apiKey: 'sk',
    }
    await expect(loadProviderModel(config)).rejects.toThrowError(
      /Unknown provider "mistral"/,
    )
  })
})

describe('createEntityLanguageModel', () => {
  function makeFakeModel(): never {
    return { __brand: 'fake-model' } as never
  }

  it('generateText 转换 user/assistant 消息并透传 system/prompt/tools', async () => {
    mockGenerateText.mockResolvedValue({
      text: '你好',
      toolCalls: undefined,
      response: { messages: [{ role: 'assistant', content: '你好' }] },
    })

    const adapter = createEntityLanguageModel(makeFakeModel())
    const result = await adapter.generateText({
      model: makeFakeModel(),
      messages: [
        { role: 'user', content: '在吗' },
        { role: 'assistant', content: '在的' },
      ],
      system: '你是 Entity',
      tools: {
        search: {
          description: '搜索',
          parameters: { type: 'object' },
          execute: vi.fn(),
        },
      },
    })

    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    const callArg = mockGenerateText.mock.calls[0]![0] as Record<string, unknown>
    expect(callArg.model).toEqual({ __brand: 'fake-model' })
    expect(callArg.system).toBe('你是 Entity')
    expect(callArg.messages).toEqual([
      { role: 'user', content: '在吗' },
      { role: 'assistant', content: '在的' },
    ])
    expect(callArg.tools).toEqual({
      search: { description: '搜索', parameters: { type: 'object' } },
    })
    expect(result.text).toBe('你好')
    expect(result.toolCalls).toBeUndefined()
    expect(result.responseMessages).toEqual([
      { role: 'assistant', content: '你好' },
    ])
  })

  it('generateText 把 tool 角色消息转为 tool-result CoreMessage', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'done',
      toolCalls: [],
      response: { messages: [] },
    })

    const adapter = createEntityLanguageModel(makeFakeModel())
    await adapter.generateText({
      model: makeFakeModel(),
      messages: [
        {
          role: 'tool',
          content: '{"ok":true}',
          toolName: 'search',
          toolResult: { ok: true },
        },
      ],
    })

    const callArg = mockGenerateText.mock.calls[0]![0] as {
      messages: Array<Record<string, unknown>>
    }
    expect(callArg.messages).toHaveLength(1)
    expect(callArg.messages[0]!.role).toBe('tool')
    const content = callArg.messages[0]!.content as Array<Record<string, unknown>>
    expect(content[0]!.type).toBe('tool-result')
    expect(content[0]!.toolName).toBe('search')
    expect(content[0]!.result).toEqual({ ok: true })
    expect(content[0]!.toolCallId).toMatch(/^call-search-/)
  })

  it('generateText 把 tool 消息无 toolName 时回退 "x" 占位', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'done',
      toolCalls: [],
      response: { messages: [] },
    })

    const adapter = createEntityLanguageModel(makeFakeModel())
    await adapter.generateText({
      model: makeFakeModel(),
      messages: [{ role: 'tool', content: 'raw' }],
    })

    const callArg = mockGenerateText.mock.calls[0]![0] as {
      messages: Array<Record<string, unknown>>
    }
    const content = callArg.messages[0]!.content as Array<Record<string, unknown>>
    expect(content[0]!.toolName).toBe('unknown')
    expect(content[0]!.toolCallId).toMatch(/^call-x-/)
    expect(content[0]!.result).toBe('raw')
  })

  it('generateText 映射 toolCalls 为 Entity 格式', async () => {
    mockGenerateText.mockResolvedValue({
      text: '调用工具',
      toolCalls: [
        { toolName: 'search', args: { q: 'aether' } },
        { toolName: 'write', args: { path: '/tmp' } },
      ],
      response: { messages: [] },
    })

    const adapter = createEntityLanguageModel(makeFakeModel())
    const result = await adapter.generateText({ model: makeFakeModel() })

    expect(result.toolCalls).toEqual([
      { toolName: 'search', args: { q: 'aether' } },
      { toolName: 'write', args: { path: '/tmp' } },
    ])
  })

  it('generateText 无 toolCalls 时返回 undefined', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'plain',
      toolCalls: undefined,
      response: { messages: [] },
    })
    const adapter = createEntityLanguageModel(makeFakeModel())
    const result = await adapter.generateText({ model: makeFakeModel() })
    expect(result.toolCalls).toBeUndefined()
  })

  it('generateText 透传 prompt（无 messages 时）', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'ok',
      toolCalls: undefined,
      response: { messages: [] },
    })
    const adapter = createEntityLanguageModel(makeFakeModel())
    await adapter.generateText({ model: makeFakeModel(), prompt: '一次性提问' })
    const callArg = mockGenerateText.mock.calls[0]![0] as Record<string, unknown>
    expect(callArg.prompt).toBe('一次性提问')
    expect(callArg.messages).toBeUndefined()
  })

  it('streamText 返回 textStream / text / toolCalls，并调用 streamText', async () => {
    const tokens = ['Hello', ' ', 'World']
    const textStream = (async function* () {
      for (const t of tokens) yield t
    })()
    mockStreamText.mockReturnValue({
      textStream,
      text: Promise.resolve('Hello World'),
      toolCalls: Promise.resolve([
        { toolName: 'search', args: { q: 'x' } },
      ]),
    })

    const adapter = createEntityLanguageModel(makeFakeModel())
    const result = await adapter.streamText!({
      model: makeFakeModel(),
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(mockStreamText).toHaveBeenCalledTimes(1)
    // 消费 textStream 验证透传
    const collected: string[] = []
    for await (const t of result.textStream) collected.push(t)
    expect(collected).toEqual(tokens)
    expect(await result.text).toBe('Hello World')
    expect(await result.toolCalls).toEqual([
      { toolName: 'search', args: { q: 'x' } },
    ])
  })

  it('streamText 无 toolCalls 时 resolve 为 undefined', async () => {
    mockStreamText.mockReturnValue({
      textStream: (async function* () {})(),
      text: Promise.resolve(''),
      toolCalls: Promise.resolve(undefined),
    })
    const adapter = createEntityLanguageModel(makeFakeModel())
    const result = await adapter.streamText!({ model: makeFakeModel() })
    expect(await result.toolCalls).toBeUndefined()
  })

  it('toCoreTools 未传 tools 时透传 undefined', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'ok',
      toolCalls: undefined,
      response: { messages: [] },
    })
    const adapter = createEntityLanguageModel(makeFakeModel())
    await adapter.generateText({ model: makeFakeModel() })
    const callArg = mockGenerateText.mock.calls[0]![0] as Record<string, unknown>
    expect(callArg.tools).toBeUndefined()
  })
})
