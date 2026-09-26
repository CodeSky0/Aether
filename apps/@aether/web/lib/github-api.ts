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

export interface GithubApi {
  client: GithubClient
  /** 列出仓库文件树（recursive） */
  listRepoTree(repoFullName: string, branch: string): Promise<RepoFileEntry[]>
  /** 读取文件内容（文本，base64 自动解码） */
  readRepoFile(repoFullName: string, branch: string, path: string): Promise<string>
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
  }
}
