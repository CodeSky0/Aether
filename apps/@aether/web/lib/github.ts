// @aether/web · GitHub App 配置解析
// 从环境变量读取 pre-created GitHub App 凭据；未配置时返回 null 优雅降级。
// App private key 只存环境变量，绝不入库（戒律：明文密钥绝不入库）。

export interface GithubAppConfig {
  /** GitHub App numeric id（AETHER_GITHUB_APP_ID） */
  appId: string
  /** App slug，用于构造安装 URL（AETHER_GITHUB_APP_SLUG） */
  appSlug: string
  /** App private key PEM（AETHER_GITHUB_APP_PRIVATE_KEY） */
  privateKeyPem: string
}

export function getGithubAppConfig(): GithubAppConfig | null {
  const appId = process.env.AETHER_GITHUB_APP_ID?.trim()
  const appSlug = process.env.AETHER_GITHUB_APP_SLUG?.trim()
  const privateKeyPem = process.env.AETHER_GITHUB_APP_PRIVATE_KEY?.trim()
  if (!appId || !appSlug || !privateKeyPem) return null
  return { appId, appSlug, privateKeyPem }
}

export function requireGithubAppConfig(): GithubAppConfig {
  const config = getGithubAppConfig()
  if (!config) {
    throw new Error(
      'GitHub App is not configured. Set AETHER_GITHUB_APP_ID, AETHER_GITHUB_APP_SLUG, and AETHER_GITHUB_APP_PRIVATE_KEY.',
    )
  }
  return config
}

/** GitHub App Webhook 签名密钥（创建 App 时设置，用于校验 X-Hub-Signature-256）。 */
export function getGithubWebhookSecret(): string | null {
  return process.env.AETHER_GITHUB_WEBHOOK_SECRET?.trim() || null
}

/** 集成凭据加密密钥（base64 编码的 32 字节）。 */
export function getIntegrationEncryptionKey(): string | null {
  return process.env.AETHER_INTEGRATION_ENCRYPTION_KEY?.trim() || null
}

export function requireIntegrationEncryptionKey(): string {
  const key = getIntegrationEncryptionKey()
  if (!key) {
    throw new Error(
      'Integration encryption key is not configured. Set AETHER_INTEGRATION_ENCRYPTION_KEY (base64-encoded 32 bytes).',
    )
  }
  return key
}
