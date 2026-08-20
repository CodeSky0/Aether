// @aether/web · Thread 列表与创建 Server Actions
'use server'
import { getDb } from '@/lib/db'
import { threads, projects } from '@aether/db'
import { desc, eq } from 'drizzle-orm'
import { requireEntitlement, requireRealmAccess } from '@/lib/auth-guard'
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
 * 列出指定 Realm 下的所有 Thread，按创建时间降序。
 */
export async function listThreads(realmId: string): Promise<ThreadRow[]> {
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
    .where(eq(threads.realm_id, realmId))
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
}
export interface CreateThreadInput {
  realmId: string
  projectId: string
  title: string
  manifestationUrl?: string
  /** 编辑器中选中的代码片段；写入 code_anchor 供 Thread 与代码联动 */
  codeAnchor?: string
}
/**
 * 创建新 Thread。
 * code_anchor 记录发起 Thread 时的编辑器选区（如有）。
 */
export async function createThread(input: CreateThreadInput): Promise<{ id: string; title: string }> {
  // P2-18 修复：鉴权守卫
  await requireEntitlement(input.realmId, {
    resource: 'thread',
    action: 'create',
    projectId: input.projectId,
  })
  const db = getDb()
  const [thread] = await db
    .insert(threads)
    .values({
      realm_id: input.realmId,
      project_id: input.projectId,
      title: input.title,
      manifestation_url: input.manifestationUrl ?? null,
      ...(input.codeAnchor ? { code_anchor: { selection: input.codeAnchor } } : {}),
    })
    .returning({ id: threads.id, title: threads.title })
  if (!thread) {
    throw new Error('Failed to create thread')
  }
  return thread
}
/**
 * 列出指定 Realm 下的 Projects（用于创建 Thread 时选择 project）。
 */
export async function listProjects(realmId: string): Promise<Array<{ id: string; name: string; slug: string }>> {
  // P2-18 修复：鉴权守卫
  await requireRealmAccess(realmId)
  const db = getDb()
  return db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.realm_id, realmId))
}
