// @aether/web · Git 仓库文件树 Server Actions（方向 1a）
// 有 GitHub 集成时从真实仓库拉文件树/内容；无集成返回 null，调用方回退硬编码。
'use server'
import { createGithubApi, type RepoFileEntry } from '@/lib/github-api'
import { listRealmIntegrations } from '@/lib/integrations'
import { getDb } from '@/lib/db'
import { projects } from '@aether/db'
import { eq } from 'drizzle-orm'
import { requireRealmAccess } from '@/lib/auth-guard'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

/** 解析 Realm 的 GitHub 仓库全名与默认分支；无集成返回 null */
async function resolveGithubRepo(
  realmId: string,
): Promise<{ repoFullName: string; branch: string } | null> {
  const integrations = await listRealmIntegrations(realmId)
  const github = integrations.find(
    (i) => i.provider === 'github' && i.status === 'active',
  )
  if (!github || !github.repo_full_name) return null
  const db = getDb()
  const [project] = await db
    .select({ default_branch: projects.default_branch })
    .from(projects)
    .where(eq(projects.realm_id, realmId))
    .limit(1)
  return {
    repoFullName: github.repo_full_name,
    branch: project?.default_branch ?? 'main',
  }
}

/**
 * 列出 Realm 绑定 GitHub 仓库的文件树（recursive）。
 * 无 GitHub 集成或未绑定 repo 时返回 null，调用方据此回退到静态文件清单。
 */
export async function listRepoTree(
  realmId: string,
): Promise<ActionResult<RepoFileEntry[] | null>> {
  return runGuarded('listRepoTree', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repo = await resolveGithubRepo(parsedRealmId)
    if (!repo) return null
    const api = createGithubApi(parsedRealmId)
    return api.listRepoTree(repo.repoFullName, repo.branch)
  })
}

/**
 * 读取 Realm 绑定 GitHub 仓库中指定路径的文件内容（文本）。
 * 无 GitHub 集成时返回 null。
 */
export async function readRepoFile(
  realmId: string,
  path: string,
): Promise<ActionResult<string | null>> {
  return runGuarded('readRepoFile', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repo = await resolveGithubRepo(parsedRealmId)
    if (!repo) return null
    const api = createGithubApi(parsedRealmId)
    return api.readRepoFile(repo.repoFullName, repo.branch, path)
  })
}
