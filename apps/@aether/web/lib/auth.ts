// @aether/web · Better-Auth 单例
// Web 只经 @aether/auth 使用 Better-Auth，不直接依赖其实现包。
import {
  createAuth,
  type AuthInstance,
  type OidcProviderConfig,
} from '@aether/auth'
import { getDb } from '@/lib/db'

let authInstance: AuthInstance | null = null

/** 登录页展示用的 OIDC provider 元数据（不含 secret）。 */
export interface WebOidcProvider {
  providerId: string
  name: string
}

/**
 * 从环境变量解析 OIDC provider 配置。
 * 全未配置 → null（不启用）；只配置其一 → 抛可读错误（配置残缺属部署错误）。
 */
export function resolveOidcProviderConfig(
  env: Record<string, string | undefined>,
): OidcProviderConfig | null {
  const discoveryUrl = env.AETHER_OIDC_DISCOVERY_URL?.trim() || undefined
  const clientId = env.AETHER_OIDC_CLIENT_ID?.trim() || undefined

  if (!discoveryUrl && !clientId) return null
  if (!discoveryUrl || !clientId) {
    throw new Error(
      'Incomplete OIDC configuration: AETHER_OIDC_DISCOVERY_URL and AETHER_OIDC_CLIENT_ID must be set together.',
    )
  }

  const scopesRaw = env.AETHER_OIDC_SCOPES?.trim()
  const clientSecret = env.AETHER_OIDC_CLIENT_SECRET?.trim() || undefined
  const issuer = env.AETHER_OIDC_ISSUER?.trim() || undefined
  return {
    providerId: env.AETHER_OIDC_PROVIDER_ID?.trim() || 'oidc',
    name: env.AETHER_OIDC_NAME?.trim() || 'SSO',
    discoveryUrl,
    clientId,
    ...(clientSecret !== undefined ? { clientSecret } : {}),
    ...(scopesRaw
      ? {
          scopes: scopesRaw
            .split(/\s+/)
            .filter((scope) => scope.length > 0),
        }
      : {}),
    pkce: env.AETHER_OIDC_PKCE === 'true',
    ...(issuer !== undefined ? { issuer } : {}),
  }
}

function createWebAuth(): AuthInstance {
  const baseURL = process.env.BETTER_AUTH_URL
  if (!baseURL) {
    throw new Error(
      'BETTER_AUTH_URL is not set. Better-Auth requires an application base URL.',
    )
  }
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not set. Better-Auth requires an explicit secret.',
    )
  }

  const oidcProvider = resolveOidcProviderConfig(process.env)

  return createAuth({
    db: getDb(),
    baseURL,
    secret,
    ...(oidcProvider ? { oauthProviders: [oidcProvider] } : {}),
    options: {
      emailAndPassword: {
        enabled: true,
      },
    },
  })
}

/** 获取 Web 进程内共享的 Better-Auth 实例。 */
export function getAuth(): AuthInstance {
  if (!authInstance) {
    authInstance = createWebAuth()
  }
  return authInstance
}

/**
 * 尝试获取 Web Better-Auth 实例。
 * 认证环境变量未配置时返回 null，供非认证开发路径优雅降级。
 */
export function tryGetAuth(): AuthInstance | null {
  if (!process.env.BETTER_AUTH_URL || !process.env.BETTER_AUTH_SECRET) {
    return null
  }
  return getAuth()
}

/**
 * 登录页可用的 OIDC provider 元数据。
 * auth 未配置或未启用 OIDC 时返回 null。
 */
export function getWebOidcProvider(): WebOidcProvider | null {
  if (!process.env.BETTER_AUTH_URL || !process.env.BETTER_AUTH_SECRET) {
    return null
  }
  try {
    const provider = resolveOidcProviderConfig(process.env)
    return provider
      ? { providerId: provider.providerId, name: provider.name }
      : null
  } catch {
    // 配置残缺时 createWebAuth 会给出明确报错；登录页按未启用处理。
    return null
  }
}

