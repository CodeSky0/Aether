// @aether/web · CI/CD Server Actions（方向 4）
// 列出 Realm 绑定 GitHub 仓库的 check runs，可选按 PR number 过滤。
'use server'
import { createGithubApi, type CheckRun } from '@/lib/github-api'
import { listRealmIntegrations } from '@/lib/integrations'
import { requireRealmAccess } from '@/lib/auth-guard'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

async function resolveRepoFullName(realmId: string): Promise<string | null> {
  const integrations = await listRealmIntegrations(realmId)
  const github = integrations.find(
    (i) => i.provider === 'github' && i.status === 'active',
  )
  return github?.repo_full_name ?? null
}

/**
 * 列出 CI check runs。
 * - 指定 prNumber 时：取 PR head_sha 的 check runs
 * - 未指定时：取默认分支最新 commit 的 check runs
 */
export async function listCiRuns(
  realmId: string,
  prNumber?: number,
): Promise<ActionResult<CheckRun[] | null>> {
  return runGuarded('listCiRuns', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repoFullName = await resolveRepoFullName(parsedRealmId)
    if (!repoFullName) return null
    const api = createGithubApi(parsedRealmId)

    if (prNumber !== undefined) {
      const pr = await api.getPR(repoFullName, prNumber)
      return api.listCheckRunsForRef(repoFullName, pr.head_sha)
    }

    // 无 PR 号：用默认分支
    const branches = await api.listBranches(repoFullName)
    const defaultBranch = branches.find((b) => b.name === 'main') ?? branches[0]
    if (!defaultBranch) return []
    return api.listCheckRunsForRef(repoFullName, defaultBranch.sha)
  })
}
