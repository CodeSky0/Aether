// @aether/web · GitHub API 句柄工厂
// 为 Realm 创建 GitHub API 客户端，token 闭环由 getValidInstallationToken 负责
//（读加密缓存 → 过期换发 → 加密写回）。提供文件树与文件内容读取端点，
// 供 Current 编辑器从真实 GitHub 仓库加载文件（方向 1a）。
// 方向 3（PR 评审）/ 方向 4（CI/CD）在此扩展更多端点。
import { createGithubClient, type GithubClient } from '@aether/resonance'
import { getValidInstallationToken } from '@/lib/integrations'

export interface RepoFileEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

export interface BranchInfo {
  name: string
  sha: string
}

export interface CommitResult {
  sha: string
}

export interface PRInfo {
  number: number
  title: string
  state: string
  head_sha: string
  base_sha: string
  author: string
  draft: boolean
}

export interface PRFile {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed'
  additions: number
  deletions: number
  patch?: string
}

export interface PRReview {
  id: number
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string | null
  reviewer: string
  submitted_at: string
}

export interface PRComment {
  id: number
  path: string
  line: number | null
  side: string | null
  body: string
  author: string
  created_at: string
}

export interface CheckRun {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  html_url: string | null
  details_url: string | null
  head_sha: string
}

export interface GithubApi {
  client: GithubClient
  /** 列出仓库文件树（recursive） */
  listRepoTree(repoFullName: string, branch: string): Promise<RepoFileEntry[]>
  /** 读取文件内容（文本，base64 自动解码） */
  readRepoFile(repoFullName: string, branch: string, path: string): Promise<string>
  /** 列出仓库分支 */
  listBranches(repoFullName: string): Promise<BranchInfo[]>
  /** 从指定分支创建新分支 */
  createBranch(repoFullName: string, fromBranch: string, newBranch: string): Promise<BranchInfo>
  /** 提交单文件到指定分支（6 步 GitHub API 流程） */
  createCommit(
    repoFullName: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<CommitResult>
  /** 获取 PR 基本信息 */
  getPR(repoFullName: string, number: number): Promise<PRInfo>
  /** 获取 PR 文件 diff 列表 */
  getPRFiles(repoFullName: string, number: number): Promise<PRFile[]>
  /** 获取 PR review 列表 */
  getPRReviews(repoFullName: string, number: number): Promise<PRReview[]>
  /** 获取 PR review 评论列表 */
  getPRComments(repoFullName: string, number: number): Promise<PRComment[]>
  /** 提交 review（approve / request changes / comment） */
  createReview(
    repoFullName: string,
    number: number,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body?: string,
  ): Promise<{ id: number }>
  /** 合并 PR */
  mergePR(repoFullName: string, number: number): Promise<{ sha: string }>
  /** 列出指定 ref（SHA 或分支名）的 check runs */
  listCheckRunsForRef(repoFullName: string, ref: string): Promise<CheckRun[]>
}

/**
 * 为 Realm 创建 GitHub API 句柄。
 * 无 GitHub 集成或集成非活跃时，首次请求抛错（fail-closed）。
 */
export function createGithubApi(realmId: string): GithubApi {
  const client = createGithubClient({
    tokenProvider: async () => {
      const token = await getValidInstallationToken(realmId)
      if (token === null) {
        throw new Error(`Realm ${realmId} 未配置 GitHub 集成或集成非活跃`)
      }
      return token
    },
  })

  return {
    client,
    async listRepoTree(repoFullName, branch) {
      const data = await client.request<{
        tree: Array<{ path: string; type: string; size?: number }>
      }>(
        `/repos/${repoFullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      )
      return data.tree
        .filter((entry) => entry.type === 'blob' || entry.type === 'tree')
        .map((entry) => ({
          path: entry.path,
          type: entry.type as 'blob' | 'tree',
          ...(entry.size !== undefined ? { size: entry.size } : {}),
        }))
    },
    async readRepoFile(repoFullName, branch, path) {
      const data = await client.request<{
        content: string
        encoding: string
      }>(
        `/repos/${repoFullName}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      )
      if (data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8')
      }
      return data.content
    },
    async listBranches(repoFullName) {
      const data = await client.request<
        Array<{ name: string; commit: { sha: string } }>
      >(`/repos/${repoFullName}/branches?per_page=100`)
      return data.map((b) => ({ name: b.name, sha: b.commit.sha }))
    },
    async createBranch(repoFullName, fromBranch, newBranch) {
      const refData = await client.request<{
        object: { sha: string }
      }>(`/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(fromBranch)}`)
      const created = await client.request<{
        object: { sha: string }
      }>(`/repos/${repoFullName}/git/refs`, {
        method: 'POST',
        body: {
          ref: `refs/heads/${newBranch}`,
          sha: refData.object.sha,
        },
      })
      return { name: newBranch, sha: created.object.sha }
    },
    async createCommit(repoFullName, branch, path, content, message) {
      // 1. 获取当前分支 ref 的 commit SHA
      const refData = await client.request<{
        object: { sha: string }
      }>(`/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(branch)}`)
      const parentSha = refData.object.sha

      // 2. 获取该 commit 的 tree SHA
      const commitData = await client.request<{
        tree: { sha: string }
      }>(`/repos/${repoFullName}/git/commits/${parentSha}`)
      const baseTreeSha = commitData.tree.sha

      // 3. 创建新 blob（文件内容 utf-8）
      const blobData = await client.request<{ sha: string }>(
        `/repos/${repoFullName}/git/blobs`,
        {
          method: 'POST',
          body: { content, encoding: 'utf-8' },
        },
      )

      // 4. 创建新 tree（基于旧 tree，替换目标文件）
      const treeData = await client.request<{ sha: string }>(
        `/repos/${repoFullName}/git/trees`,
        {
          method: 'POST',
          body: {
            base_tree: baseTreeSha,
            tree: [
              {
                path,
                mode: '100644',
                type: 'blob',
                sha: blobData.sha,
              },
            ],
          },
        },
      )

      // 5. 创建新 commit
      const newCommitData = await client.request<{ sha: string }>(
        `/repos/${repoFullName}/git/commits`,
        {
          method: 'POST',
          body: {
            message,
            tree: treeData.sha,
            parents: [parentSha],
          },
        },
      )

      // 6. 更新分支 ref 指向新 commit
      await client.request(
        `/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(branch)}`,
        {
          method: 'PATCH',
          body: { sha: newCommitData.sha },
        },
      )

      return { sha: newCommitData.sha }
    },
    async getPR(repoFullName, number) {
      const data = await client.request<{
        number: number
        title: string
        state: string
        draft: boolean
        head: { sha: string }
        base: { sha: string }
        user: { login: string }
      }>(`/repos/${repoFullName}/pulls/${number}`)
      return {
        number: data.number,
        title: data.title,
        state: data.state,
        head_sha: data.head.sha,
        base_sha: data.base.sha,
        author: data.user.login,
        draft: data.draft,
      }
    },
    async getPRFiles(repoFullName, number) {
      const data = await client.request<
        Array<{
          filename: string
          status: string
          additions: number
          deletions: number
          patch?: string
        }>
      >(`/repos/${repoFullName}/pulls/${number}/files?per_page=100`)
      return data.map((f) => ({
        filename: f.filename,
        status: f.status as PRFile['status'],
        additions: f.additions,
        deletions: f.deletions,
        ...(f.patch !== undefined ? { patch: f.patch } : {}),
      }))
    },
    async getPRReviews(repoFullName, number) {
      const data = await client.request<
        Array<{
          id: number
          state: string
          body: string | null
          user: { login: string } | null
          submitted_at: string
        }>
      >(`/repos/${repoFullName}/pulls/${number}/reviews?per_page=100`)
      return data.map((r) => ({
        id: r.id,
        state: r.state as PRReview['state'],
        body: r.body,
        reviewer: r.user?.login ?? 'unknown',
        submitted_at: r.submitted_at,
      }))
    },
    async getPRComments(repoFullName, number) {
      const data = await client.request<
        Array<{
          id: number
          path: string
          line: number | null
          side: string | null
          body: string
          user: { login: string } | null
          created_at: string
        }>
      >(`/repos/${repoFullName}/pulls/${number}/comments?per_page=100`)
      return data.map((c) => ({
        id: c.id,
        path: c.path,
        line: c.line,
        side: c.side,
        body: c.body,
        author: c.user?.login ?? 'unknown',
        created_at: c.created_at,
      }))
    },
    async createReview(repoFullName, number, event, body) {
      const data = await client.request<{ id: number }>(
        `/repos/${repoFullName}/pulls/${number}/reviews`,
        {
          method: 'POST',
          body: {
            event,
            ...(body !== undefined ? { body } : {}),
          },
        },
      )
      return { id: data.id }
    },
    async mergePR(repoFullName, number) {
      const data = await client.request<{ sha: string }>(
        `/repos/${repoFullName}/pulls/${number}/merge`,
        { method: 'PUT' },
      )
      return { sha: data.sha }
    },
    async listCheckRunsForRef(repoFullName, ref) {
      const data = await client.request<{
        check_runs: Array<{
          id: number
          name: string
          status: string
          conclusion: string | null
          started_at: string | null
          completed_at: string | null
          html_url: string | null
          details_url: string | null
          head_sha: string
        }>
      }>(`/repos/${repoFullName}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`)
      return data.check_runs.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status as CheckRun['status'],
        conclusion: r.conclusion,
        started_at: r.started_at,
        completed_at: r.completed_at,
        html_url: r.html_url,
        details_url: r.details_url,
        head_sha: r.head_sha,
      }))
    },
  }
}
