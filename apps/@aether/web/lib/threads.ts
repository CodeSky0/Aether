// @aether/web · Thread 列表与创建 Server Actions
// Production 约定：入参过 zod 校验，返回 ActionResult，软删除 Thread 一律过滤。
// M3.18 API-First 收口：createThread 消费 Resonance 业务核心（core.ts），
// 与公开 API 共享同一业务实现（校验 + 审计 + Webhook 事件，同事务）。
'use server'
import { getDb } from '@/lib/db'
import { threads, projects } from '@aether/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  requireEntitlement,
  requireRealmAccess,
  resolveCurrentActor,
} from '@/lib/auth-guard'
import { runGuarded, realmIdField, uuidField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'
import { coreCreateThread } from '@/lib/resonance/core'

export interface ThreadRow {
  id: string
  realm_id: string
  project_id: string
  title: string
  status: string
  manifestation_url?: string
  created_at: Date
}

/**
 * 列出指定 Realm 下未删除的 Thread，按创建时间降序。
 */
export async function listThreads(realmId: string): Promise<ActionResult<ThreadRow[]>> {
  return runGuarded('listThreads', async () => {
    // P2-18 修复：鉴权守卫
    await requireRealmAccess(realmId)
    const db = getDb()
    const rows = await db
      .select({
        id: threads.id,
        realm_id: threads.realm_id,
        project_id: threads.project_id,
        title: threads.title,
        status: threads.status,
        manifestation_url: threads.manifestation_url,
        created_at: threads.created_at,
      })
      .from(threads)
      .where(and(eq(threads.realm_id, realmId), isNull(threads.deleted_at)))
      .orderBy(desc(threads.created_at))
    return rows.map((r): ThreadRow => ({
      id: r.id,
      realm_id: r.realm_id,
      project_id: r.project_id,
      title: r.title,
      status: r.status,
      created_at: r.created_at,
      ...(r.manifestation_url !== null ? { manifestation_url: r.manifestation_url } : {}),
    }))
  })
}

export interface CreateThreadInput {
  realmId: string
  projectId: string
  title: string
  manifestationUrl?: string
  /** 编辑器中选中的代码片段；写入 code_anchor 供 Thread 与代码联动 */
  codeAnchor?: string
}

const createThreadInputSchema = z.object({
  realmId: realmIdField,
  projectId: uuidField,
  title: z.string().trim().min(1, 'Thread 标题不能为空').max(200, '标题最长 200 字符'),
  manifestationUrl: z.url('manifestationUrl 必须是合法 URL').optional(),
  codeAnchor: z.string().max(10_000, '选区内容过长').optional(),
})

/**
 * 创建新 Thread。
 * code_anchor 记录发起 Thread 时的编辑器选区（如有）。
 * 会话通道审计归因当前用户（无会话回退 web-client，与 Current 通道一致）。
 */
export async function createThread(
  input: CreateThreadInput,
): Promise<ActionResult<{ id: string; title: string }>> {
  return runGuarded('createThread', async () => {
    const parsed = createThreadInputSchema.parse(input)
    // P2-18 修复：鉴权守卫
    await requireEntitlement(parsed.realmId, {
      resource: 'thread',
      action: 'create',
      projectId: parsed.projectId,
    })
    const sessionActor = await resolveCurrentActor()
    const actor = sessionActor ?? {
      actorType: 'human' as const,
      actorId: 'web-client',
    }
    const result = await coreCreateThread(getDb(), {
      realmId: parsed.realmId,
      projectId: parsed.projectId,
      title: parsed.title,
      ...(parsed.manifestationUrl !== undefined
        ? { manifestationUrl: parsed.manifestationUrl }
        : {}),
      ...(parsed.codeAnchor !== undefined
        ? { codeAnchor: { selection: parsed.codeAnchor } }
        : {}),
      actor: { ...actor, source: 'session' },
    })
    if (!result.ok) {
      throw new Error(result.message)
    }
    return { id: result.data.id, title: result.data.title }
  })
}

/**
 * 列出指定 Realm 下的 Projects（用于创建 Thread 时选择 project）。
 */
export async function listProjects(
  realmId: string,
): Promise<ActionResult<Array<{ id: string; name: string; slug: string }>>> {
  return runGuarded('listProjects', async () => {
    // P2-18 修复：鉴权守卫
    await requireRealmAccess(realmId)
    const db = getDb()
    return db
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(eq(projects.realm_id, realmId))
  })
}
