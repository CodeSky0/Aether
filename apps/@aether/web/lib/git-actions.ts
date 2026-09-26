// @aether/web · Git 仓库文件树 Server Actions（方向 1a 只读 + 1b 写操作）
// 有 GitHub 集成时从真实仓库拉文件树/内容；无集成返回 null，调用方回退硬编码。
// 1b 扩展：提交单文件 / 列出分支 / 创建分支。
'use server'
import { createGithubApi, type RepoFileEntry, type BranchInfo, type CommitResult } from '@/lib/github-api'
import { listRealmIntegrations } from '@/lib/integrations'
import { getDb } from '@/lib/db'
import { projects } from '@aether/db'
import { eq } from 'drizzle-orm'
import { requireRealmAccess } from '@/lib/auth-guard'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'
import { GithubClientError } from '@aether/resonance'

/** 解析 Realm 的 GitHub 仓库全名与分支；无集成返回 null。branchOverride 优先于项目默认分支 */
async function resolveGithubRepo(
  realmId: string,
  branchOverride?: string,
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
    branch: branchOverride ?? project?.default_branch ?? 'main',
  }
}

/**
 * 列出 Realm 绑定 GitHub 仓库的文件树（recursive）。
 * 无 GitHub 集成或未绑定 repo 时返回 null，调用方据此回退到静态文件清单。
 */
export async function listRepoTree(
  realmId: string,
  branch?: string,
): Promise<ActionResult<RepoFileEntry[] | null>> {
  return runGuarded('listRepoTree', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repo = await resolveGithubRepo(parsedRealmId, branch)
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
  branch?: string,
): Promise<ActionResult<string | null>> {
  return runGuarded('readRepoFile', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repo = await resolveGithubRepo(parsedRealmId, branch)
    if (!repo) return null
    const api = createGithubApi(parsedRealmId)
    return api.readRepoFile(repo.repoFullName, repo.branch, path)
  })
}

/**
 * 列出 Realm 绑定 GitHub 仓库的所有分支。
 * 无 GitHub 集成时返回 null。
 */
export async function listBranches(
  realmId: string,
): Promise<ActionResult<BranchInfo[] | null>> {
  return runGuarded('listBranches', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repo = await resolveGithubRepo(parsedRealmId)
    if (!repo) return null
    const api = createGithubApi(parsedRealmId)
    return api.listBranches(repo.repoFullName)
  })
}

/**
 * 从指定分支创建新分支。
 * 无 GitHub 集成时返回 null。
 */
export async function createBranch(
  realmId: string,
  fromBranch: string,
  newBranch: string,
): Promise<ActionResult<BranchInfo | null>> {
  return runGuarded('createBranch', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repo = await resolveGithubRepo(parsedRealmId)
    if (!repo) return null
    const api = createGithubApi(parsedRealmId)
    return api.createBranch(repo.repoFullName, fromBranch, newBranch)
  })
}

/**
 * 提交单文件到 Realm 绑定 GitHub 仓库的当前分支。
 * 走 GitHub API 6 步创建 commit 流程（getRef→getCommit→createBlob→createTree→createCommit→updateRef）。
 * 冲突（远程已更新）时返回友好错误，不做 merge/rebase。
 */
export async function commitFile(
  realmId: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
): Promise<ActionResult<CommitResult | null>> {
  return runGuarded('commitFile', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repo = await resolveGithubRepo(parsedRealmId, branch)
    if (!repo) return null
    const api = createGithubApi(parsedRealmId)
    try {
      return await api.createCommit(
        repo.repoFullName,
        repo.branch,
        path,
        content,
        message,
      )
    } catch (err) {
      if (err instanceof GithubClientError && err.status === 409) {
        throw new Error('远程分支已有更新，请刷新文件后重新提交')
      }
      throw err
    }
  })
}
