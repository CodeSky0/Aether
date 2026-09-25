// @aether/resonance · GitHub REST API 客户端
// 基于原生 fetch，自动注入 installation access token 鉴权。
// tokenProvider 闭包由 web 层注入（负责缓存/换发/加密写回闭环），
// 使本包不依赖 DB / env，保持纯函数可测试性。

const GITHUB_API = 'https://api.github.com'

export class GithubClientError extends Error {
  readonly status: number
  readonly body: string
  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'GithubClientError'
    this.status = status
    this.body = body
  }
}

export interface GithubClientOptions {
  /** 获取有效 installation access token 的闭包（由 web 层注入，负责缓存/换发） */
  tokenProvider: () => Promise<string>
}

export interface GithubRequestInit {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

export interface GithubClient {
  /** 发起 GitHub API 请求，自动注入鉴权 header。返回解析后的 JSON（204 返回 undefined）。 */
  request<T>(path: string, init?: GithubRequestInit): Promise<T>
}

/**
 * 创建 GitHub API 客户端。
 * 每次请求自动调 tokenProvider 获取有效 token，注入 Authorization header。
 */
export function createGithubClient(options: GithubClientOptions): GithubClient {
  return {
    async request<T>(path: string, init: GithubRequestInit = {}): Promise<T> {
      const token = await options.tokenProvider()
      const headers: Record<string, string> = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      }
      const res = await fetch(`${GITHUB_API}${path}`, {
        method: init.method ?? 'GET',
        headers,
        ...(init.body !== undefined
          ? { body: JSON.stringify(init.body) }
          : {}),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new GithubClientError(
          `GitHub API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${res.statusText}`,
          res.status,
          body,
        )
      }
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    },
  }
}
