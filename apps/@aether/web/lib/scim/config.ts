// @aether/web · SCIM provisioning 配置解析
// 环境变量驱动、单 Realm 绑定；fail-fast 策略与 OIDC（M3.14）一致。

export interface ScimConfig {
  /** Bearer token（服务器到服务器凭据，高权限：直接开通成员）。 */
  token: string
  /** SCIM 管辖的 Aether Realm id。 */
  realmId: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const SCIM_TOKEN_MIN_LENGTH = 16

/**
 * 从环境变量解析 SCIM 配置。
 * 全未配置 → null（SCIM 关闭，路由一律 404）；
 * 只配置其一 / token 过短 / realmId 非 UUID → 抛可读错误（部署错误不静默降级）。
 */
export function resolveScimConfig(
  env: Record<string, string | undefined>,
): ScimConfig | null {
  const token = env.AETHER_SCIM_TOKEN?.trim() || undefined
  const realmId = env.AETHER_SCIM_REALM_ID?.trim() || undefined

  if (!token && !realmId) return null
  if (!token || !realmId) {
    throw new Error(
      'Incomplete SCIM configuration: AETHER_SCIM_TOKEN and AETHER_SCIM_REALM_ID must be set together.',
    )
  }
  if (token.length < SCIM_TOKEN_MIN_LENGTH) {
    throw new Error(
      `Invalid SCIM configuration: AETHER_SCIM_TOKEN must be at least ${SCIM_TOKEN_MIN_LENGTH} characters.`,
    )
  }
  if (!UUID_RE.test(realmId)) {
    throw new Error(
      'Invalid SCIM configuration: AETHER_SCIM_REALM_ID must be a UUID.',
    )
  }
  return { token, realmId }
}
