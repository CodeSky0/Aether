// @aether/web · Resonance 业务核心层（API-First 收口）
// 职责：与主体无关、与传输无关的业务操作唯一实现——
//   业务规则（project 归属 / Thread 状态机 / dialogue_ref 竞争回写）
//   + 同事务审计 + 事务性 outbox（Webhook 事件入队）。
// 三个通道（公开 API / 会话 Server Actions / GitHub 集成）全部消费本层；
// 通道层各自负责鉴权、入参校验与错误映射。
// 禁止：返回 HTTP Response、import 任何 'use server' 模块（会话耦合）。
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'

import { dialogueMessages, projects, threads } from '@aether/db'
import type { ActorType } from '@aether/types'
import type { getDb } from '@/lib/db'
import { recordAuditEntry } from '@/lib/audit-write'
import { enqueueWebhookDeliveries } from '@/lib/webhooks/service'
import { isThreadStatusTransitionAllowed, type ThreadRecord, type ThreadStatus } from './protocol'

export type CoreDatabase = ReturnType<typeof getDb>

/** 业务操作的审计归因主体；source 同时作为审计幂等键前缀（通道标识）。 */
export interface CoreActor {
  actorType: ActorType
  actorId: string
  source: 'api-key' | 'session' | 'github'
}

export type CoreErrorCode =
  | 'not_found'
  | 'invalid_project'
  | 'invalid_status_transition'

export type CoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: CoreErrorCode; message: string }

const THREAD_COLUMNS = {
  id: threads.id,
  realm_id: threads.realm_id,
  project_id: threads.project_id,
  title: threads.title,
  status: threads.status,
  manifestation_url: threads.manifestation_url,
  dialogue_ref: threads.dialogue_ref,
  code_anchor: threads.code_anchor,
  created_at: threads.created_at,
  updated_at: threads.updated_at,
} as const

/** Thread 守卫：按 id 取本 Realm 内未删除的 Thread；未命中返回 null。 */
export async function requireThreadRow(
  db: CoreDatabase,
  realmId: string,
  threadId: string,
): Promise<ThreadRecord | null> {
  const [row] = await db
    .select(THREAD_COLUMNS)
    .from(threads)
    .where(
      and(
        eq(threads.id, threadId),
        eq(threads.realm_id, realmId),
        isNull(threads.deleted_at),
      ),
    )
    .limit(1)
  return row ?? null
}

// ---- Thread 创建 ----

export interface CoreCreateThreadInput {
  realmId: string
  projectId: string
  title: string
  /** null 表示不设置（与会话 / API 的可选语义一致）。 */
  manifestationUrl?: string | null
  /** 结构化 code_anchor：API / 会话传 { selection }，GitHub 传 issue anchor。 */
  codeAnchor?: Record<string, unknown>
  actor: CoreActor
}

/** 创建 Thread：project 归属校验 → 事务内 insert + 审计 + thread.created 入队。 */
export async function coreCreateThread(
  db: CoreDatabase,
  input: CoreCreateThreadInput,
): Promise<CoreResult<ThreadRecord>> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, input.projectId), eq(projects.realm_id, input.realmId)),
    )
    .limit(1)
  if (!project) {
    return {
      ok: false,
      code: 'invalid_project',
      message: 'project_id does not reference a project in this realm.',
    }
  }

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(threads)
      .values({
        realm_id: input.realmId,
        project_id: input.projectId,
        title: input.title,
        manifestation_url: input.manifestationUrl ?? null,
        ...(input.codeAnchor !== undefined ? { code_anchor: input.codeAnchor } : {}),
      })
      .returning(THREAD_COLUMNS)
    if (!inserted) throw new Error('Failed to create thread')

    await recordAuditEntry(tx, {
      realmId: input.realmId,
      actor: { actorType: input.actor.actorType, actorId: input.actor.actorId },
      action: 'write',
      target: {
        kind: 'thread',
        thread_id: inserted.id,
        project_id: inserted.project_id,
        title: inserted.title,
        source: input.actor.source,
      },
      idempotencyKey: `${input.actor.source}:thread.create:${inserted.id}`,
      result: { status: inserted.status },
    })
    // 事务性 outbox：thread.created 事件与业务变更同事务入队
    await enqueueWebhookDeliveries(tx, {
      realmId: input.realmId,
      eventType: 'thread.created',
      data: {
        thread_id: inserted.id,
        project_id: inserted.project_id,
        title: inserted.title,
      },
    })
    return inserted
  })
  return { ok: true, data: row }
}

// ---- Thread 状态迁移 / manifestation 绑定 ----

export interface CorePatchThreadInput {
  threadId: string
  realmId: string
  /** 状态机校验通过才迁移；同值为 no-op（不发射事件）。 */
  status?: ThreadStatus
  /** null 解绑；undefined 不变。 */
  manifestationUrl?: string | null
  actor: CoreActor
}

/** Thread 更新：守卫 → 状态机校验 → 事务内 update + 审计 + 状态迁移事件入队。 */
export async function corePatchThread(
  db: CoreDatabase,
  input: CorePatchThreadInput,
): Promise<CoreResult<ThreadRecord>> {
  const thread = await requireThreadRow(db, input.realmId, input.threadId)
  if (thread === null) {
    return { ok: false, code: 'not_found', message: 'Thread not found.' }
  }

  if (
    input.status !== undefined &&
    !isThreadStatusTransitionAllowed(thread.status, input.status)
  ) {
    return {
      ok: false,
      code: 'invalid_status_transition',
      message: `Cannot transition thread status from '${thread.status}' to '${input.status}'.`,
    }
  }

  const row = await db.transaction(async (tx) => {
    const changes: Record<string, unknown> = {}
    if (input.status !== undefined && input.status !== thread.status) {
      changes.status = input.status
    }
    if (input.manifestationUrl !== undefined) {
      changes.manifestation_url = input.manifestationUrl
    }
    const [updated] = await tx
      .update(threads)
      .set({ ...changes, updated_at: new Date() })
      .where(
        and(
          eq(threads.id, input.threadId),
          eq(threads.realm_id, input.realmId),
          isNull(threads.deleted_at),
        ),
      )
      .returning(THREAD_COLUMNS)
    if (!updated) throw new Error('Failed to update thread')

    await recordAuditEntry(tx, {
      realmId: input.realmId,
      actor: { actorType: input.actor.actorType, actorId: input.actor.actorId },
      action: 'write',
      target: {
        kind: 'thread',
        thread_id: input.threadId,
        source: input.actor.source,
        changes,
      },
      idempotencyKey: `${input.actor.source}:thread.update:${input.threadId}:${randomUUID()}`,
      result: { status: updated.status },
    })
    // 状态实际迁移时发射 thread.status_changed（同值 PATCH 为 no-op，不发射）
    if (input.status !== undefined && input.status !== thread.status) {
      await enqueueWebhookDeliveries(tx, {
        realmId: input.realmId,
        eventType: 'thread.status_changed',
        data: {
          thread_id: input.threadId,
          from: thread.status,
          to: input.status,
        },
      })
    }
    return updated
  })
  return { ok: true, data: row }
}

// ---- Dialogue 追加 ----

export interface CoreAppendDialogueInput {
  threadId: string
  realmId: string
  role: 'user' | 'assistant'
  content: string
  /** 审计主体（通道归因，如 api-key:<id> / github:<installationId>）。 */
  actor: CoreActor
  /** 消息归因主体（如 API Key 创建者 / GitHub 评论者）。 */
  messageActor: { actorType: ActorType; actorId: string }
  /** 消息 metadata（via / key_id / source 等，通道自定）。 */
  metadata: Record<string, unknown>
}

export interface CoreAppendDialogueResult {
  message: {
    id: string
    seq: number
    role: string
    content: string
    actor_type: string
    actor_id: string
    metadata: unknown
    created_at: Date
  }
  dialogueId: string
}

/** 追加对话消息：dialogue_ref 竞争回写 → insert → touch → 审计 + 事件入队。 */
export async function coreAppendDialogue(
  db: CoreDatabase,
  input: CoreAppendDialogueInput,
): Promise<CoreResult<CoreAppendDialogueResult>> {
  const thread = await requireThreadRow(db, input.realmId, input.threadId)
  if (thread === null) {
    return { ok: false, code: 'not_found', message: 'Thread not found.' }
  }

  const result = await db.transaction(async (tx) => {
    // dialogue_ref 为空 → 生成新 dialogue_id 并条件回写；
    // 并发首条消息竞争失败方重读 thread 行挂接既有 dialogue（幂等收敛）。
    let dialogueRef = thread.dialogue_ref
    if (dialogueRef === null) {
      const newRef = randomUUID()
      const won = await tx
        .update(threads)
        .set({ dialogue_ref: newRef, updated_at: new Date() })
        .where(and(eq(threads.id, input.threadId), isNull(threads.dialogue_ref)))
        .returning({ dialogue_ref: threads.dialogue_ref })
      if (won.length > 0) {
        dialogueRef = won[0]?.dialogue_ref ?? newRef
      } else {
        const [reread] = await tx
          .select({ dialogue_ref: threads.dialogue_ref })
          .from(threads)
          .where(eq(threads.id, input.threadId))
          .limit(1)
        // 竞争失败意味着并发事务已写入 dialogue_ref；重读仍为空属不变量破坏，fail-closed。
        if (!reread?.dialogue_ref) {
          throw new Error('Failed to resolve dialogue_ref for thread')
        }
        dialogueRef = reread.dialogue_ref
      }
    }

    const [row] = await tx
      .insert(dialogueMessages)
      .values({
        realm_id: input.realmId,
        dialogue_id: dialogueRef,
        actor_type: input.messageActor.actorType,
        actor_id: input.messageActor.actorId,
        role: input.role,
        content: input.content,
        metadata: input.metadata,
      })
      .returning({
        id: dialogueMessages.id,
        seq: dialogueMessages.seq,
        role: dialogueMessages.role,
        content: dialogueMessages.content,
        actor_type: dialogueMessages.actor_type,
        actor_id: dialogueMessages.actor_id,
        metadata: dialogueMessages.metadata,
        created_at: dialogueMessages.created_at,
      })
    if (!row) throw new Error('Failed to append dialogue message')

    await tx
      .update(threads)
      .set({ updated_at: new Date() })
      .where(eq(threads.id, input.threadId))

    await recordAuditEntry(tx, {
      realmId: input.realmId,
      actor: { actorType: input.actor.actorType, actorId: input.actor.actorId },
      action: 'converse',
      target: {
        kind: 'thread',
        thread_id: input.threadId,
        dialogue_id: dialogueRef,
        message_id: row.id,
        source: input.actor.source,
      },
      idempotencyKey: `${input.actor.source}:dialogue.create:${row.id}`,
      result: { role: row.role, seq: row.seq },
    })
    // 事务性 outbox：dialogue.message_created 与业务变更同事务入队
    await enqueueWebhookDeliveries(tx, {
      realmId: input.realmId,
      eventType: 'dialogue.message_created',
      data: {
        thread_id: input.threadId,
        dialogue_id: dialogueRef,
        message_id: row.id,
        seq: row.seq,
        role: row.role,
      },
    })
    return { message: row, dialogueId: dialogueRef }
  })
  return { ok: true, data: result }
}
