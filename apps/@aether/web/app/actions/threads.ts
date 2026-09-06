// @aether/web · Thread 对话 Server Actions（会话通道）
// M3.18 API-First 收口：对话追加消费 Resonance 业务核心（core.ts），
// 与公开 API 共享同一业务实现（dialogue_ref 竞争回写 + 审计 + Webhook 事件）。
// 会话通道审计归因当前用户（无会话回退 web-client）。
'use server'
import { getDb } from '@/lib/db'
import { dialogueMessages, threads } from '@aether/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  requireEntitlement,
  requireRealmAccess,
  resolveCurrentActor,
} from '@/lib/auth-guard'
import { runGuarded, realmIdField, uuidField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'
import { coreAppendDialogue } from '@/lib/resonance/core'

export interface DialogueRow {
  id: string
  seq: number
  role: string
  content: string
  actor_type: string
  actor_id: string
  created_at: Date
}

const listDialoguesSchema = z.object({
  realmId: realmIdField,
  threadId: uuidField,
})

/**
 * 列出 Thread 的对话历史，按 seq 升序。
 * dialogue_ref 为空时返回空列表（Thread 尚无对话）。
 */
export async function listDialogues(
  realmId: string,
  threadId: string,
): Promise<ActionResult<DialogueRow[]>> {
  return runGuarded('listDialogues', async () => {
    const parsed = listDialoguesSchema.parse({ realmId, threadId })
    await requireRealmAccess(parsed.realmId)
    const db = getDb()

    const [thread] = await db
      .select({ dialogue_ref: threads.dialogue_ref })
      .from(threads)
      .where(
        and(
          eq(threads.id, parsed.threadId),
          eq(threads.realm_id, parsed.realmId),
          isNull(threads.deleted_at),
        ),
      )
      .limit(1)
    if (!thread) return []
    if (!thread.dialogue_ref) return []

    const rows = await db
      .select({
        id: dialogueMessages.id,
        seq: dialogueMessages.seq,
        role: dialogueMessages.role,
        content: dialogueMessages.content,
        actor_type: dialogueMessages.actor_type,
        actor_id: dialogueMessages.actor_id,
        created_at: dialogueMessages.created_at,
      })
      .from(dialogueMessages)
      .where(
        and(
          eq(dialogueMessages.realm_id, parsed.realmId),
          eq(dialogueMessages.dialogue_id, thread.dialogue_ref),
        ),
      )
      .orderBy(asc(dialogueMessages.seq))
    return rows
  })
}

const appendUserDialogueSchema = z.object({
  realmId: realmIdField,
  threadId: uuidField,
  content: z.string().trim().min(1, '消息内容不能为空').max(20_000, '消息内容过长'),
})

/**
 * 会话通道追加用户消息。
 * 消费 coreAppendDialogue（dialogue_ref 竞争回写 + 审计 + Webhook 事件，同事务）。
 * 审计归因当前会话用户（无会话回退 web-client）。
 */
export async function appendUserDialogue(
  input: z.infer<typeof appendUserDialogueSchema>,
): Promise<ActionResult<{ messageId: string; seq: number; dialogueId: string }>> {
  return runGuarded('appendUserDialogue', async () => {
    const parsed = appendUserDialogueSchema.parse(input)
    await requireEntitlement(parsed.realmId, {
      resource: 'thread',
      action: 'update',
    })
    const sessionActor = await resolveCurrentActor()
    const actor = sessionActor ?? {
      actorType: 'human' as const,
      actorId: 'web-client',
    }
    const db = getDb()
    const result = await coreAppendDialogue(db, {
      threadId: parsed.threadId,
      realmId: parsed.realmId,
      role: 'user',
      content: parsed.content,
      actor: { ...actor, source: 'session' },
      messageActor: actor,
      metadata: { via: 'web-session' },
    })
    if (!result.ok) {
      throw new Error(result.message)
    }
    return {
      messageId: result.data.message.id,
      seq: result.data.message.seq,
      dialogueId: result.data.dialogueId,
    }
  })
}
