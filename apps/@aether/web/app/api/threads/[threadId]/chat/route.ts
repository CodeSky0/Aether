// @aether/web · Entity 流式对话端点
// POST /api/threads/[threadId]/chat  body: { realmId, content, entityId? }
//
// 链路：会话鉴权 → 写用户消息（coreAppendDialogue）→ 实例化 EntityRuntime
//   → streamChat 逐 token 流 → 完成后写 Entity 回复（coreAppendDialogue）→ 审计
// 未配置 LLM provider 时返回 503；Realm 无 active Entity 时返回 404。
import type { NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { tryGetAuth } from '@/lib/auth'
import { entities, threads } from '@aether/db'
import { resolveSessionActor } from '@aether/auth'
import { coreAppendDialogue } from '@/lib/resonance/core'
import {
  createEntityLanguageModel,
  createEntityRuntime,
  loadProviderModel,
  resolveProviderConfig,
  type EntityChatMessage,
} from '@aether/entity-core'

export const runtime = 'nodejs'

interface ChatRequestBody {
  realmId: string
  content: string
  entityId?: string
}

async function resolveActor() {
  const auth = tryGetAuth()
  if (auth === null) {
    return { actorType: 'human' as const, actorId: 'web-client' }
  }
  try {
    const sessionActor = await resolveSessionActor(auth, await headers())
    if (sessionActor === null) {
      return { actorType: 'human' as const, actorId: 'web-client' }
    }
    return sessionActor
  } catch {
    return { actorType: 'human' as const, actorId: 'web-client' }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params
  let body: ChatRequestBody
  try {
    body = (await request.json()) as ChatRequestBody
  } catch {
    return Response.json(
      { error: { code: 'bad_request', message: 'Invalid JSON body' } },
      { status: 400 },
    )
  }
  const { realmId, content, entityId } = body
  if (!realmId || !content?.trim()) {
    return Response.json(
      { error: { code: 'bad_request', message: 'realmId and content are required' } },
      { status: 400 },
    )
  }

  // provider 配置检查
  const providerConfig = resolveProviderConfig()
  if (providerConfig === null) {
    return Response.json(
      {
        error: {
          code: 'provider_not_configured',
          message:
            'LLM provider 未配置；请设置 AETHER_ENTITY_PROVIDER / AETHER_ENTITY_MODEL 及对应 API Key。',
        },
      },
      { status: 503 },
    )
  }

  const db = getDb()

  // 校验 Thread 归属本 Realm
  const [thread] = await db
    .select({ id: threads.id, dialogue_ref: threads.dialogue_ref })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.realm_id, realmId)))
    .limit(1)
  if (!thread) {
    return Response.json(
      { error: { code: 'not_found', message: 'Thread not found' } },
      { status: 404 },
    )
  }

  // 加载 Entity：指定 entityId 或取 Realm 第一个 active Entity
  const entityCondition = entityId
    ? and(eq(entities.realm_id, realmId), eq(entities.id, entityId), eq(entities.status, 'active'))
    : and(eq(entities.realm_id, realmId), eq(entities.status, 'active'))
  const [entity] = await db
    .select()
    .from(entities)
    .where(entityCondition)
    .limit(1)
  if (!entity) {
    return Response.json(
      { error: { code: 'no_active_entity', message: 'Realm 内无可用 active Entity' } },
      { status: 404 },
    )
  }

  const actor = await resolveActor()

  // 写用户消息
  const userMsgResult = await coreAppendDialogue(db, {
    threadId,
    realmId,
    role: 'user',
    content: content.trim(),
    actor: { ...actor, source: 'session' },
    messageActor: actor,
    metadata: { via: 'web-session-chat' },
  })
  if (!userMsgResult.ok) {
    return Response.json(
      { error: { code: userMsgResult.code, message: userMsgResult.message } },
      { status: 400 },
    )
  }

  // 加载 provider model + 实例化 EntityRuntime
  let model
  try {
    const providerModel = await loadProviderModel(providerConfig)
    model = createEntityLanguageModel(providerModel)
  } catch (err) {
    return Response.json(
      {
        error: {
          code: 'provider_load_failed',
          message: err instanceof Error ? err.message : 'Failed to load LLM provider',
        },
      },
      { status: 503 },
    )
  }

  const runtime = createEntityRuntime({
    entity,
    model,
    manifesto: entity.capability_manifesto as never,
  })

  // 构造历史消息（取最近对话）
  const dialogueId = userMsgResult.data.dialogueId
  const { dialogueMessages } = await import('@aether/db')
  const historyRows = await db
    .select({
      role: dialogueMessages.role,
      content: dialogueMessages.content,
    })
    .from(dialogueMessages)
    .where(and(eq(dialogueMessages.realm_id, realmId), eq(dialogueMessages.dialogue_id, dialogueId)))
    .orderBy(dialogueMessages.seq)
  const history: EntityChatMessage[] = historyRows.map((r) => ({
    role: r.role,
    content: r.content,
  }))

  // 流式响应
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = await runtime.streamChat(
          db as never,
          realmId,
          history,
          undefined,
          {
            onToken: (token) => {
              controller.enqueue(encoder.encode(token))
            },
          },
        )

        // 写 Entity 回复到 dialogue
        await coreAppendDialogue(db, {
          threadId,
          realmId,
          role: 'assistant',
          content: result.reply,
          actor: {
            actorType: 'entity',
            actorId: entity.id,
            source: 'session',
          },
          messageActor: { actorType: 'entity', actorId: entity.id },
          metadata: {
            via: 'entity-runtime-stream',
            toolCalls: result.toolCalls,
            auditIds: result.auditIds,
          },
        })

        controller.close()
      } catch (err) {
        controller.error(
          encoder.encode(
            `\n[Entity error: ${err instanceof Error ? err.message : 'unknown'}]`,
          ),
        )
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-cache',
      'x-aether-entity': entity.id,
    },
  })
}
