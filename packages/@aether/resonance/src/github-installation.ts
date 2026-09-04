// @aether/resonance · GitHub App installation access token 获取
// 用 App JWT 换取某 installation 的短时 access token（GitHub 默认 1 小时），
// 用于以该 installation 身份调用 GitHub API（issues / pull_requests / contents）。
// token 应加密缓存于 realm_integrations.encrypted_token，过期前可复用；
// 过期后用本函数实时换发。
import { signAppJwt, type GithubAppCredentials } from './github-jwt'

export interface InstallationAccessToken {
  token: string
  expiresAt: Date
}

const GITHUB_API = 'https://api.github.com'

export class GithubInstallationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GithubInstallationError'
  }
}

/**
 * 换取 installation access token。
 * @param installationId GitHub App installation id（数字字符串）
 * @param creds GitHub App 凭据（appId + private key）
 */
export async function fetchInstallationAccessToken(
  installationId: string,
  creds: GithubAppCredentials,
): Promise<InstallationAccessToken> {
  const jwt = await signAppJwt(creds)
  const res = await fetch(
    `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GithubInstallationError(
      `GitHub access token request failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    )
  }
  const body = (await res.json()) as { token: string; expires_at: string }
  return {
    token: body.token,
    expiresAt: new Date(body.expires_at),
  }
}
