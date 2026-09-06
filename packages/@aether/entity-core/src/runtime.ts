// @aether/entity-core · Entity AI Runtime
// Vercel AI SDK 接入的 Entity 运行时：对话生成、工具调用、权限门禁、审计落库。
//
// 设计要点：
// - 以 Vercel AI SDK 的 LanguageModel 接口为抽象，不强依赖具体 provider。
//   调用方传入 model（如 anthropic()/xai()/openai()），runtime 只消费通用接口。
// - 工具调用受 Capability Manifesto 的 available_tools 白名单约束。
// - 敏感操作需 HandoffGate 审批（checkpoint before destructive tool calls）。
// - 全部对话与工具调用通过 audit trail 记录，actor_type='entity'。
// - memory_ref 用于持久化 Entity 的跨 Thread 上下文记忆。
import type { HandoffGate } from './handoff.js'
import {
  canInvokeTool,
  validateCapabilityManifesto,
  type CapabilityManifesto,
  type StoredCapabilityManifesto,
} from './manifesto.js'
import {
  computePayloadHash,
  recordEntityAction,
  type AuditDb,
} from './audit.js'
import type { EntityRecord } from './identity.js'
import type { EntityStatus } from '@aether/types'

/**
 * Vercel AI SDK LanguageModel 的最小子集接口。
 * 只暴露 runtime 真正需要的方法，便于 mock 测试。
 * 生产使用时传入 `import { generateText } from 'ai'` 兼容的模型。
 */
export interface EntityLanguageModel {
  generateText(options: {
    model: unknown
    prompt?: string
    messages?: EntityChatMessage[]
    tools?: Record<string, EntityToolDefinition>
    system?: string
    maxSteps?: number
  }): Promise<EntityTextResult>
  /** 流式生成；真实 provider 适配器实现，mock 可省略（streamChat 回退模拟）。 */
  streamText?(options: {
    model: unknown
    prompt?: string
    messages?: EntityChatMessage[]
    tools?: Record<string, EntityToolDefinition>
    system?: string
    maxSteps?: number
  }): Promise<EntityStreamResult>
}

export interface EntityTextResult {
  text: string
  toolCalls?: Array<{
    toolName: string
    args: Record<string, unknown>
  }> | undefined
  responseMessages?: unknown[] | undefined
}

export interface EntityStreamResult {
  /** 逐 token 异步迭代；消费完成后 text Promise resolve。 */
  textStream: AsyncIterable<string>
  /** 完整文本（流消费完成后 resolve）。 */
  text: PromiseLike<string>
  /** 工具调用（流 + 工具循环完成后 resolve）。 */
  toolCalls?: PromiseLike<
    Array<{
      toolName: string
      args: Record<string, unknown>
    }> | undefined
  >
}

export interface EntityChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolName?: string
  toolResult?: unknown
}

export interface EntityToolDefinition {
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
  /** 标记为 true 的工具需要 HandoffGate 审批 */
  requiresHandoff?: boolean
  /** Realm statement 格式的权限要求，如 'thread:update' */
  permissionScope?: string
}

export interface EntityRuntimeOptions {
  entity: EntityRecord
  model: EntityLanguageModel
  manifesto: CapabilityManifesto
  handoffGate?: HandoffGate
  systemPrompt?: string
  maxToolIterations?: number
}

export interface EntityChatResult {
  reply: string
  toolCalls: Array<{
    toolName: string
    args: Record<string, unknown>
    result: unknown
    handoffRequired: boolean
    handoffApproved: boolean
  }>
  auditIds: string[]
}

export interface EntityStreamOptions {
  signal?: AbortSignal
  onToken?: (token: string) => void
}

const DEFAULT_MAX_TOOL_ITERATIONS = 10

export class EntityRuntime {
  private readonly entity: EntityRecord
  private readonly model: EntityLanguageModel
  private readonly manifesto: CapabilityManifesto
  private readonly handoffGate: HandoffGate | undefined
  private readonly systemPrompt: string
  private readonly maxToolIterations: number
  private conversationHistory: EntityChatMessage[] = []

  constructor(options: EntityRuntimeOptions) {
    this.entity = options.entity
    this.model = options.model
    this.manifesto = options.manifesto
    this.handoffGate = options.handoffGate
    const manifestoData = options.entity.capability_manifesto as Record<string, unknown>
    const capabilities = (manifestoData['capabilities'] as string[] | undefined) ?? []
    this.systemPrompt =
      options.systemPrompt ??
      `You are Entity ${options.entity.display_name}. ` +
      `Your capabilities: ${capabilities.join(', ') || 'general assistant'}. ` +
      `Always follow your manifesto constraints.`
    this.maxToolIterations =
      options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS
  }

  getEntityId(): string {
    return this.entity.id
  }

  getEntityStatus(): EntityStatus {
    return this.entity.status
  }

  getManifesto(): CapabilityManifesto {
    return this.manifesto
  }

  getConversationHistory(): ReadonlyArray<EntityChatMessage> {
    return [...this.conversationHistory]
  }

  clearConversationHistory(): void {
    this.conversationHistory = []
  }

  /**
   * 同步对话：发送消息，获取回复，自动处理工具调用。
   * 全流程审计落库。
   */
  async chat(
    db: AuditDb,
    realmId: string,
    messages: EntityChatMessage[],
    tools?: Record<string, EntityToolDefinition>,
  ): Promise<EntityChatResult> {
    if (!this.canAct()) {
      throw new Error(
        `Entity ${this.entity.id} is not active (status=${this.entity.status}). Cannot chat.`,
      )
    }

    const auditIds: string[] = []
    const allMessages = [
      { role: 'system' as const, content: this.systemPrompt },
      ...this.conversationHistory,
      ...messages,
    ]

    const boundTools = this.filterToolsByManifesto(tools)
    const toolCalls: EntityChatResult['toolCalls'] = []

    let iteration = 0
    let lastResult: EntityTextResult | null = null

    while (iteration < this.maxToolIterations) {
      iteration++

      const result = await this.model.generateText({
        model: this.model,
        messages: allMessages,
        tools: boundTools,
        maxSteps: 1,
      })

      lastResult = result

      // Log the assistant message
      const assistantMsg: EntityChatMessage = {
        role: 'assistant',
        content: result.text,
      }
      allMessages.push(assistantMsg)

      // Log audit for the AI response
      const auditRecord = await recordEntityAction(db, realmId, this.entity.id, {
        action: 'converse',
        target: { type: 'chat_response', iteration },
        payload: result.text,
        idempotencyKey: `chat-${Date.now()}-${iteration}`,
        result: { textLength: result.text.length },
      })
      auditIds.push(auditRecord.id)

      // Handle tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          const toolDef = boundTools[tc.toolName]
          if (!toolDef) {
            continue
          }

          // Check handoff requirement
          let handoffRequired = false
          const handoffApproved = false

          if (toolDef.requiresHandoff && this.handoffGate) {
            handoffRequired = true
            const payloadHash = computePayloadHash(tc.args)
            const req = this.handoffGate.requestHandoff({
              operation: `tool:${tc.toolName}`,
              payloadHash,
            })

            // Log handoff request
            await recordEntityAction(db, realmId, this.entity.id, {
              action: 'permission_change',
              target: { type: 'handoff_request', tool: tc.toolName, requestId: req.id },
              payload: tc.args,
              idempotencyKey: `handoff-${req.id}`,
              result: { status: 'waiting' },
            })

            // For non-interactive mode, we throw to let caller handle
            throw new EntityHandoffRequiredError(req.id, tc.toolName, tc.args)
          }

          // Execute the tool
          const toolResult = await toolDef.execute(tc.args)

          // Add tool result to conversation
          allMessages.push({
            role: 'tool',
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            toolName: tc.toolName,
            toolResult,
          })

          // Log tool execution audit
          const toolAudit = await recordEntityAction(db, realmId, this.entity.id, {
            action: 'execute',
            target: { type: 'tool_call', tool: tc.toolName },
            payload: tc.args,
            idempotencyKey: `tool-${Date.now()}-${tc.toolName}`,
            result: { output: typeof toolResult === 'string' ? toolResult.slice(0, 500) : 'structured' },
          })
          auditIds.push(toolAudit.id)

          toolCalls.push({
            toolName: tc.toolName,
            args: tc.args,
            result: toolResult,
            handoffRequired,
            handoffApproved,
          })
        }

        // Continue loop with tool results fed back
        continue
      }

      // No more tool calls, break
      break
    }

    // Store conversation
    this.conversationHistory = allMessages.slice(-20)

    return {
      reply: lastResult?.text ?? '',
      toolCalls,
      auditIds,
    }
  }

  /**
   * 流式对话：逐条 token 回调。
   * 真实 provider（model.streamText 存在）→ 逐 token 流式 + 审计落库；
   * mock model（无 streamText）→ 回退 chat + 逐字符模拟，保持测试兼容。
   */
  async streamChat(
    db: AuditDb,
    realmId: string,
    messages: EntityChatMessage[],
    tools?: Record<string, EntityToolDefinition>,
    options: EntityStreamOptions = {},
  ): Promise<EntityChatResult> {
    if (!this.canAct()) {
      throw new Error(`Entity ${this.entity.id} is not active.`)
    }

    // 真实流式路径
    if (this.model.streamText) {
      const allMessages: EntityChatMessage[] = [
        { role: 'system', content: this.systemPrompt },
        ...this.conversationHistory,
        ...messages,
      ]
      const boundTools = this.filterToolsByManifesto(tools)

      const stream = await this.model.streamText({
        model: this.model,
        messages: allMessages,
        tools: boundTools,
        maxSteps: 1,
      })

      let reply = ''
      if (options.onToken) {
        for await (const token of stream.textStream) {
          reply += token
          options.onToken(token)
        }
      } else {
        reply = await stream.text
      }

      const streamedToolCalls = stream.toolCalls
        ? await stream.toolCalls
        : undefined

      // 审计：AI 回复落 entity 行为轨迹
      const auditIds: string[] = []
      const auditRecord = await recordEntityAction(db, realmId, this.entity.id, {
        action: 'converse',
        target: { type: 'chat_response', mode: 'stream' },
        payload: reply,
        idempotencyKey: `stream-${Date.now()}`,
        result: { textLength: reply.length },
      })
      auditIds.push(auditRecord.id)

      // 工具调用审计
      const toolCalls: EntityChatResult['toolCalls'] = []
      if (streamedToolCalls) {
        for (const tc of streamedToolCalls) {
          const toolAudit = await recordEntityAction(db, realmId, this.entity.id, {
            action: 'execute',
            target: { type: 'tool_call', tool: tc.toolName },
            payload: tc.args,
            idempotencyKey: `stream-tool-${Date.now()}-${tc.toolName}`,
            result: { streamed: true },
          })
          auditIds.push(toolAudit.id)
          toolCalls.push({
            toolName: tc.toolName,
            args: tc.args,
            result: undefined,
            handoffRequired: false,
            handoffApproved: false,
          })
        }
      }

      this.conversationHistory = [
        ...allMessages.slice(1),
        { role: 'assistant' as const, content: reply },
      ].slice(-20)

      return { reply, toolCalls, auditIds }
    }

    // 回退：mock model 逐字符模拟（现有行为，测试兼容）
    const result = await this.chat(db, realmId, messages, tools)
    if (options.onToken) {
      for (const char of result.reply) {
        options.onToken(char)
      }
    }
    return result
  }

  /**
   * 检查 Entity 是否可以执行操作。
   */
  canAct(): boolean {
    if (this.handoffGate) {
      return this.handoffGate.canAct()
    }
    return this.entity.status === 'active'
  }

  /**
   * 将工具白名单过滤为 manifesto 声明的可用工具。
   */
  private filterToolsByManifesto(
    tools?: Record<string, EntityToolDefinition>,
  ): Record<string, EntityToolDefinition> {
    if (!tools || this.manifesto.available_tools.length === 0) {
      return {}
    }
    const filtered: Record<string, EntityToolDefinition> = {}
    for (const [name, def] of Object.entries(tools)) {
      if (canInvokeTool(this.manifesto, name)) {
        filtered[name] = def
      }
    }
    return filtered
  }

  /**
   * 更新实体的 memory_ref（跨 Thread 上下文记忆）。
   */
  async updateMemory(
    db: AuditDb,
    realmId: string,
    updates: Record<string, unknown>,
  ): Promise<void> {
    // Log the memory update to audit trail
    await recordEntityAction(db, realmId, this.entity.id, {
      action: 'write',
      target: { type: 'memory_update' },
      payload: updates,
      idempotencyKey: `memory-${Date.now()}`,
      result: { updatedKeys: Object.keys(updates) },
    });
    // Persist memory_ref to entity record
    this.entity.memory_ref = Object.assign({}, this.entity.memory_ref as Record<string, unknown>, updates);
  }
}

export class EntityHandoffRequiredError extends Error {
  public readonly requestId: string
  public readonly toolName: string
  public readonly toolArgs: Record<string, unknown>

  constructor(
    requestId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ) {
    super(`Handoff required for tool: ${toolName} (request: ${requestId})`)
    this.name = 'EntityHandoffRequiredError'
    this.requestId = requestId
    this.toolName = toolName
    this.toolArgs = toolArgs
  }
}

/**
 * 便捷工厂：从 Entity 档案 + manifesto 创建 Runtime。
 */
export function createEntityRuntime(params: {
  entity: EntityRecord
  model: EntityLanguageModel
  manifesto: StoredCapabilityManifesto
  handoffGate?: HandoffGate
  systemPrompt?: string
  maxToolIterations?: number
}): EntityRuntime {
  const result = validateCapabilityManifesto(params.manifesto)
  const manifesto = result.manifesto
  if (!manifesto) {
    throw new Error('Invalid entity manifesto: ' + result.errors.join(', '))
  }
  return new EntityRuntime({
    entity: params.entity,
    model: params.model,
    manifesto,
    ...(params.handoffGate !== undefined ? { handoffGate: params.handoffGate } : {}),
    ...(params.systemPrompt !== undefined ? { systemPrompt: params.systemPrompt } : {}),
    ...(params.maxToolIterations !== undefined ? { maxToolIterations: params.maxToolIterations } : {}),
  })
}