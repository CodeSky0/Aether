// @aether/auth · OIDC provider 配置映射
// 仅本包内部接触 better-auth 的 genericOAuth 插件；下游只使用 OidcProviderConfig。
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth'

/** Web / 下游声明的 OIDC provider 配置（不含 better-auth 实现细节）。 */
export interface OidcProviderConfig {
  /** 稳定标识，用于回调路由与登录按钮。 */
  providerId: string
  /** 登录按钮显示名（如 "企业 SSO"）。 */
  name: string
  /** IdP 的 .well-known/openid-configuration 地址。 */
  discoveryUrl: string
  clientId: string
  /** confidential client 必填；PKCE public client 可省。 */
  clientSecret?: string
  /** 默认 ['openid', 'email', 'profile']。 */
  scopes?: string[]
  /** 默认 false。 */
  pkce?: boolean
  /** 显式 issuer 校验（RFC 9207）；缺省使用 discovery 文档的 issuer。 */
  issuer?: string
}

export const DEFAULT_OIDC_SCOPES: readonly string[] = ['openid', 'email', 'profile']

/**
 * 把对外配置映射为 better-auth genericOAuth 插件配置。
 * redirectURI 显式构造为 `${baseURL}/api/auth/oauth2/callback/${providerId}`，
 * 与 IdP 侧需要登记的回调地址保持同一约定。
 */
export function toGenericOAuthConfig(
  config: OidcProviderConfig,
  baseURL: string,
): GenericOAuthConfig {
  return {
    providerId: config.providerId,
    discoveryUrl: config.discoveryUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes ? [...config.scopes] : [...DEFAULT_OIDC_SCOPES],
    pkce: config.pkce,
    issuer: config.issuer,
    redirectURI: `${baseURL}/api/auth/oauth2/callback/${config.providerId}`,
  }
}
