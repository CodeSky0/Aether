// @aether/resonance · GitHub App JWT 签名（RS256）
// GitHub App 服务端鉴权：用 App private key 签一个短时 JWT（iss=appId, iat, exp），
// 作为 Bearer 调用 /app/* 端点换取 installation access token。
// private key 只存环境变量（AETHER_GITHUB_APP_PRIVATE_KEY），绝不入库。
import {
  base64ToBytes,
  bytesToBase64Url,
  stringToBase64Url,
  toArrayBuffer,
} from './encoding'

export interface GithubAppCredentials {
  /** GitHub App numeric id（环境变量 AETHER_GITHUB_APP_ID） */
  appId: string
  /** App private key PEM（环境变量 AETHER_GITHUB_APP_PRIVATE_KEY） */
  privateKeyPem: string
}

export class GithubJwtError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GithubJwtError'
  }
}

// GitHub 要求 exp - iat ≤ 10 分钟；留 1 分钟余量 + 60s 时钟偏移容忍。
const GITHUB_JWT_TTL_SECONDS = 9 * 60
const CLOCK_SKEW_SECONDS = 60

/** 剥离 PEM armor 并 base64-decode 为 DER ArrayBuffer（Web Crypto importKey 输入）。 */
function pemToDer(pem: string): ArrayBuffer {
  const trimmed = pem.trim()
  const headerMatch = trimmed.match(/^-----BEGIN ([A-Z ]+)-----/)
  if (!headerMatch) {
    throw new GithubJwtError('Private key is not a valid PEM (missing header)')
  }
  const keyType = headerMatch[1]
  // Web Crypto importKey('pkcs8') 仅接受 PKCS#8（"PRIVATE KEY"）。
  // GitHub App key 默认 PKCS#8；若拿到 PKCS#1（"RSA PRIVATE KEY"）需先用 openssl 转换。
  if (keyType === 'RSA PRIVATE KEY') {
    throw new GithubJwtError(
      'Private key is PKCS#1 (RSA) format. Convert to PKCS#8: ' +
        '`openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem`',
    )
  }
  if (keyType !== 'PRIVATE KEY') {
    throw new GithubJwtError(`Unsupported PEM key type: ${keyType}`)
  }
  const body = trimmed
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s/g, '')
  return toArrayBuffer(base64ToBytes(body))
}

/** 签发 GitHub App JWT（RS256）。 */
export async function signAppJwt(creds: GithubAppCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iat: now - CLOCK_SKEW_SECONDS,
    exp: now + GITHUB_JWT_TTL_SECONDS,
    iss: creds.appId,
  }
  const header = { alg: 'RS256', typ: 'JWT' }
  const headerB64 = stringToBase64Url(JSON.stringify(header))
  const payloadB64 = stringToBase64Url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`

  let key: CryptoKey
  try {
    key = await globalThis.crypto.subtle.importKey(
      'pkcs8',
      pemToDer(creds.privateKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch (error) {
    throw new GithubJwtError('Failed to import GitHub App private key', {
      cause: error,
    })
  }

  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )
  const sigB64 = bytesToBase64Url(new Uint8Array(signature))
  return `${signingInput}.${sigB64}`
}
