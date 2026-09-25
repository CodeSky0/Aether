// @aether/web · GitHub API 句柄工厂
// 为 Realm 创建 GitHub API 客户端，token 闭环由 getValidInstallationToken 负责
//（读加密缓存 → 过期换发 → 加密写回）。方向 3（PR 评审）/ 方向 4（CI/CD）
// 在此扩展具体端点方法（getPR / createReview / mergePR / listCheckRuns 等）。
import { createGithubClient, type GithubClient } from '@aether/resonance'
import { getValidInstallationToken } from '@/lib/integrations'

export interface GithubApi {
  client: GithubClient
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
  return { client }
}
