// @aether/web · PR 评审 Server Actions（方向 3）
// 聚合 PR 数据供 UI 渲染，并提供 approve / request changes / merge / comment 写操作。
'use server'
import { createGithubApi, type PRInfo, type PRFile, type PRReview, type PRComment } from '@/lib/github-api'
import { listRealmIntegrations } from '@/lib/integrations'
import { requireRealmAccess } from '@/lib/auth-guard'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

/** PR 详情聚合：基本信息 + 文件 diff + reviews + comments */
export interface PRDetail {
  pr: PRInfo
  files: PRFile[]
  reviews: PRReview[]
  comments: PRComment[]
}

/** 解析 Realm 的 GitHub 仓库全名；无集成返回 null */
async function resolveRepoFullName(realmId: string): Promise<string | null> {
  const integrations = await listRealmIntegrations(realmId)
  const github = integrations.find(
    (i) => i.provider === 'github' && i.status === 'active',
  )
  return github?.repo_full_name ?? null
}

/** 获取 PR 详情聚合（基本信息 + diff + reviews + comments） */
export async function getPRDetail(
  realmId: string,
  prNumber: number,
): Promise<ActionResult<PRDetail | null>> {
  return runGuarded('getPRDetail', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repoFullName = await resolveRepoFullName(parsedRealmId)
    if (!repoFullName) return null
    const api = createGithubApi(parsedRealmId)
    const [pr, files, reviews, comments] = await Promise.all([
      api.getPR(repoFullName, prNumber),
      api.getPRFiles(repoFullName, prNumber),
      api.getPRReviews(repoFullName, prNumber),
      api.getPRComments(repoFullName, prNumber),
    ])
    return { pr, files, reviews, comments }
  })
}

/** Approve PR */
export async function approvePR(
  realmId: string,
  prNumber: number,
  body?: string,
): Promise<ActionResult<{ id: number } | null>> {
  return runGuarded('approvePR', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repoFullName = await resolveRepoFullName(parsedRealmId)
    if (!repoFullName) return null
    const api = createGithubApi(parsedRealmId)
    return api.createReview(repoFullName, prNumber, 'APPROVE', body)
  })
}

/** Request changes on PR */
export async function requestChanges(
  realmId: string,
  prNumber: number,
  body?: string,
): Promise<ActionResult<{ id: number } | null>> {
  return runGuarded('requestChanges', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repoFullName = await resolveRepoFullName(parsedRealmId)
    if (!repoFullName) return null
    const api = createGithubApi(parsedRealmId)
    return api.createReview(repoFullName, prNumber, 'REQUEST_CHANGES', body)
  })
}

/** 合并 PR */
export async function mergePR(
  realmId: string,
  prNumber: number,
): Promise<ActionResult<{ sha: string } | null>> {
  return runGuarded('mergePR', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repoFullName = await resolveRepoFullName(parsedRealmId)
    if (!repoFullName) return null
    const api = createGithubApi(parsedRealmId)
    return api.mergePR(repoFullName, prNumber)
  })
}

/** 添加 PR 评论 */
export async function addPRComment(
  realmId: string,
  prNumber: number,
  body: string,
): Promise<ActionResult<{ id: number } | null>> {
  return runGuarded('addPRComment', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    await requireRealmAccess(parsedRealmId)
    const repoFullName = await resolveRepoFullName(parsedRealmId)
    if (!repoFullName) return null
    const api = createGithubApi(parsedRealmId)
    return api.createReview(repoFullName, prNumber, 'COMMENT', body)
  })
}
