// @aether/entity-core · LLM Provider 适配层
// 把 Vercel AI SDK 的真实模型适配进 EntityLanguageModel 接口，支持多 provider 可切换。
//
// 设计要点：
// - entity-core 只硬依赖 `ai` 核心；provider 包（@ai-sdk/anthropic 等）运行时动态 import，
//   未安装时抛清晰错误，不阻塞构建。
// - provider 由环境变量选择：AETHER_ENTITY_PROVIDER / AETHER_ENTITY_MODEL + 各 provider API Key。
// - 未配置 provider 时 resolveProviderConfig 返回 null，runtime 保持现有抽象行为（向后兼容）。
// - 适配器实现 generateText（非流式）与 streamText（流式），消息/工具格式双向转换。
import type { LanguageModel } from 'ai'

import type {
  EntityChatMessage,
  EntityLanguageModel,
  EntityTextResult,
  EntityToolDefinition,
} from './runtime.js'

/** 支持的 provider 标识；新增 provider 在此扩展 + loadProviderModel 增加分支。 */
export type EntityProvider = 'anthropic' | 'openai' | 'xai'

export interface ProviderConfig {
  provider: EntityProvider
  modelId: string
  apiKey: string
}

/**
 * 从环境变量解析 provider 配置。
 * 返回 null 表示未配置（runtime 保持抽象行为，向后兼容）。
 * 配置不完整（缺 API Key）时抛错，避免静默降级到无模型状态。
 */
export function resolveProviderConfig(): ProviderConfig | null {
  const provider = process.env['AETHER_ENTITY_PROVIDER']
  if (!provider) return null
  const modelId = process.env['AETHER_ENTITY_MODEL']
  if (!modelId) {
    throw new Error(
      'AETHER_ENTITY_PROVIDER 已配置但 AETHER_ENTITY_MODEL 缺失；两者必须成对。',
    )
  }
  const apiKey = resolveApiKey(provider)
  if (!apiKey) {
    throw new Error(
      `Provider "${provider}" 的 API Key 环境变量缺失；请配置后重试。`,
    )
  }
  return { provider: provider as EntityProvider, modelId, apiKey }
}

function resolveApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'anthropic':
      return process.env['ANTHROPIC_API_KEY']
    case 'openai':
      return process.env['OPENAI_API_KEY']
    case 'xai':
      return process.env['XAI_API_KEY']
    default:
      return undefined
  }
}

/**
 * 动态加载 provider 包并创建 LanguageModel。
 * provider 包是 optional 依赖；未安装时抛清晰错误指引安装。
 */
export async function loadProviderModel(config: ProviderConfig): Promise<LanguageModel> {
  switch (config.provider) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      const client = createAnthropic({ apiKey: config.apiKey })
      return client(config.modelId)
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const client = createOpenAI({ apiKey: config.apiKey })
      return client(config.modelId)
    }
    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai')
      const client = createXai({ apiKey: config.apiKey })
      return client(config.modelId)
    }
    default: {
      throw new Error(
        `Unknown provider "${(config as { provider: string }).provider}"; install the corresponding @ai-sdk/* package.`,
      )
    }
  }
}

/** EntityChatMessage → AI SDK CoreMessage（基础消息；工具结果单独处理）。 */
function toCoreMessages(messages: EntityChatMessage[]): unknown[] {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result',
            toolName: msg.toolName ?? 'unknown',
            toolCallId: `call-${msg.toolName ?? 'x'}-${msg.content.length}`,
            result: msg.toolResult ?? msg.content,
          },
        ],
      }
    }
    return { role: msg.role, content: msg.content }
  })
}

/** EntityToolDefinition → AI SDK tool 定义。 */
function toCoreTools(
  tools?: Record<string, EntityToolDefinition>,
): Record<string, unknown> | undefined {
  if (!tools) return undefined
  const result: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tools)) {
    result[name] = {
      description: def.description,
      parameters: def.parameters,
    }
  }
  return result
}

/** AI SDK toolCalls → Entity 格式。 */
function fromToolCalls(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> | undefined,
): EntityTextResult['toolCalls'] {
  if (!toolCalls || toolCalls.length === 0) return undefined
  return toolCalls.map((tc) => ({ toolName: tc.toolName, args: tc.args }))
}

/**
 * 把 AI SDK LanguageModel 适配进 EntityLanguageModel 接口。
 * 同时实现 generateText（非流式）与 streamText（流式）。
 */
export function createEntityLanguageModel(model: LanguageModel): EntityLanguageModel {
  return {
    async generateText(options): Promise<EntityTextResult> {
      const { generateText } = await import('ai')
      const result = await generateText({
        model,
        messages: options.messages
          ? (toCoreMessages(options.messages) as never[])
          : undefined,
        prompt: options.prompt,
        tools: toCoreTools(options.tools) as never,
        system: options.system,
      } as never)
      return {
        text: result.text,
        toolCalls: fromToolCalls(
          result.toolCalls as unknown as Array<{
            toolName: string
            args: Record<string, unknown>
          }>,
        ),
        responseMessages: result.response.messages,
      }
    },
    async streamText(options) {
      const { streamText } = await import('ai')
      const result = streamText({
        model,
        messages: options.messages
          ? (toCoreMessages(options.messages) as never[])
          : undefined,
        prompt: options.prompt,
        tools: toCoreTools(options.tools) as never,
        system: options.system,
      } as never)
      return {
        textStream: result.textStream,
        text: result.text,
        toolCalls: Promise.resolve(
          result.toolCalls as unknown as Array<{
            toolName: string
            args: Record<string, unknown>
          }> | undefined,
        ).then(fromToolCalls),
      }
    },
  }
}
