// @aether/resonance · OAuth App Registry 纯函数层
// 提供 OAuth 2.0 授权码流程（+ PKCE S256）的无状态构件：
//   client_id / client_secret / authorization code / access token 生成、
//   PKCE 校验、scope 目录解析、redirect_uri 策略校验。
// 哈希与入库由调用方（web 服务层）负责；本层不触库、不感知 HTTP。
// 哈希走 Web Crypto（subtle.digest），与 github-jwt 同范式，环境无关。
import { bytesToBase64Url } from './encoding'

export const OAUTH_CLIENT_ID_PREFIX = 'oapp_'
export const OAUTH_CLIENT_SECRET_PREFIX = 'osec_'
export const OAUTH_ACCESS_TOKEN_PREFIX = 'aoat_'
export const OAUTH_AUTHORIZATION_CODE_PREFIX = 'oac_'

/** v1 scope 目录：read → GET/HEAD；write → POST/PATCH/DELETE。 */
export const OAUTH_SCOPES = ['read', 'write'] as const
export type OAuthScope = (typeof OAUTH_SCOPES)[number]

/** scope 参数缺省值。 */
export const OAUTH_DEFAULT_SCOPES: readonly OAuthScope[] = ['read']

/** authorization code 有效期（10 分钟）。 */
export const OAUTH_CODE_TTL_MS = 10 * 60 * 1000

function randomBase64Url(bytes: number): string {
  return bytesToBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)))
}

/** client_id 明文：oapp_<16B base64url>（约 22 字符）。 */
export function generateClientId(): string {
  return `${OAUTH_CLIENT_ID_PREFIX}${randomBase64Url(16)}`
}

/** client_secret 明文：osec_<32B base64url>；哈希入库，明文仅创建时返回。 */
export function generateClientSecret(): string {
  return `${OAUTH_CLIENT_SECRET_PREFIX}${randomBase64Url(32)}`
}

/** authorization code 明文：oac_<32B base64url>；哈希入库，10 分钟一次性。 */
export function generateAuthorizationCode(): string {
  return `${OAUTH_AUTHORIZATION_CODE_PREFIX}${randomBase64Url(32)}`
}

/** access token 明文：aoat_<32B base64url>；哈希入库，明文仅兑换时返回。 */
export function generateAccessToken(): string {
  return `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBase64Url(32)}`
}

async function sha256Bytes(plaintext: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(plaintext),
  )
  return new Uint8Array(digest)
}

/** sha256 十六进制（client_secret / code / token 统一哈希策略）。 */
export async function sha256Hex(plaintext: string): Promise<string> {
  const bytes = await sha256Bytes(plaintext)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

// ---- scope 解析 ----

/** 解析空格分隔的 scope 参数；非法值返回 null（fail-closed，不静默裁剪）。 */
export function parseOAuthScopes(scope: string | null | undefined): readonly OAuthScope[] | null {
  if (scope === null || scope === undefined || scope.trim() === '') {
    return OAUTH_DEFAULT_SCOPES
  }
  const items = scope.trim().split(/\s+/)
  const seen = new Set<string>()
  for (const item of items) {
    if (!OAUTH_SCOPES.includes(item as OAuthScope)) return null
    seen.add(item)
  }
  return [...seen] as OAuthScope[]
}

/** scope 是否覆盖给定 method 所需权限（GET/HEAD → read；其余 → write）。 */
export function scopeAllowsMethod(
  scopes: readonly string[],
  method: string,
): boolean {
  const required = isReadMethod(method) ? 'read' : 'write'
  return scopes.includes(required)
}

export function isReadMethod(method: string): boolean {
  const normalized = method.toUpperCase()
  return normalized === 'GET' || normalized === 'HEAD'
}

// ---- PKCE（RFC 7636，S256 only）----

/** code_challenge / code_verifier 合法长度（base64url 43-128 字符）。 */
export function isValidPkceValue(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

/** S256 校验：sha256(verifier) base64url 后与 challenge 恒等比较。 */
export async function verifyPkceS256(
  verifier: string,
  challenge: string,
): Promise<boolean> {
  if (!isValidPkceValue(verifier) || !isValidPkceValue(challenge)) return false
  const digest = await sha256Bytes(verifier)
  return bytesToBase64Url(digest) === challenge
}

// ---- redirect_uri 策略 ----

/**
 * 注册与授权统一的 redirect_uri 策略：
 *   合法 URL + https；例外 loopback（http://localhost / http://127.0.0.1）
 *   供本地开发。匹配采用精确字符串比较（不做前缀 / 通配）。
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (uri.length > 2048) return false
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol === 'http:') {
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  }
  return false
}

/** redirect_uri 精确匹配（授权请求与兑换请求都必须等于注册值之一）。 */
export function matchesRedirectUri(
  candidate: string,
  registered: readonly string[],
): boolean {
  return registered.includes(candidate)
}
