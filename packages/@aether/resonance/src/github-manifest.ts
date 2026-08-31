// @aether/resonance · GitHub App Manifest 一次性创建
// manifest flow：宿主把 manifest JSON 发给 GitHub 拿到 code，用户访问
// https://github.com/settings/apps/new?code={code}，GitHub 创建 App 后回调 setup_url
// 带回 code；POST /app-manifests/{code}/conversions 用 code 换取已创建 App 的凭据
//（id, slug, pem, webhook_secret 等）。仅在首次部署创建 App 时使用；
// 运行期 Realm 集成走 pre-created App 的 OAuth install/callback。

export interface GithubAppManifest {
  name: string
  url: string
  hook_attributes?: { url: string }
  redirect_url?: string
  setup_url?: string
  callback_urls?: string[]
  default_events?: string[]
  default_permissions?: Record<string, string>
  description?: string
  public?: boolean
}

export interface GithubAppCreationResult {
  id: number
  slug: string
  name: string
  pem: string
  client_id: string
  client_secret: string
  webhook_secret?: string
  url: string
}

const GITHUB_API = 'https://api.github.com'

export class GithubManifestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GithubManifestError'
  }
}

/**
 * 用 manifest code 换取已创建 GitHub App 的凭据。
 * 部署脚本调用：拿到凭据后写入环境变量，App 即可投入使用。
 */
export async function createAppFromManifest(
  code: string,
): Promise<GithubAppCreationResult> {
  const res = await fetch(
    `${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json' },
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GithubManifestError(
      `GitHub manifest conversion failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    )
  }
  return (await res.json()) as GithubAppCreationResult
}

/**
 * Aether 默认 GitHub App manifest 骨架（issues/PRs/contents/metadata 权限）。
 * 宿主填入 url/hook_attributes.url/setup_url 后用于一次性 App 创建。
 * 权限对齐 Phase Shift 规范：Issue↔Thread、PR↔Manifestation 双向共振所需最小集。
 */
export const aetherGithubAppManifest: Omit<GithubAppManifest, 'url'> = {
  name: 'Aether Resonance',
  description:
    'Aether DevOS — Realm ↔ GitHub 双向共振（Issue↔Thread, PR↔Manifestation）',
  public: false,
  default_events: ['issues', 'issue_comment', 'pull_request', 'push'],
  default_permissions: {
    issues: 'write',
    pull_requests: 'write',
    contents: 'read',
    metadata: 'read',
  },
}
