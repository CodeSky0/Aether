// @aether/resonance · Resonance 凭据加密
// AES-GCM 256：加密 installation access token 等短时凭据，密文落库。
// 密钥由宿主注入（AETHER_INTEGRATION_ENCRYPTION_KEY，base64 编码的 32 字节）。
// 输出格式：base64(iv(12) ‖ ciphertext ‖ tag(16))，GCM 认证 tag 附在密文末尾。
// 解密时校验 tag——篡改或密钥不匹配即抛错，满足"明文密钥绝不入库"的戒律。
import { base64ToBytes, bytesToBase64, toArrayBuffer } from './encoding.js'

const IV_BYTES = 12
const KEY_BYTES = 32

export class ResonanceCryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ResonanceCryptoError'
  }
}

/**
 * 从 base64 编码的 32 字节原始密钥导入 AES-GCM CryptoKey。
 * 密钥来源：环境变量 AETHER_INTEGRATION_ENCRYPTION_KEY。
 */
export async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyBase64)
  if (raw.length !== KEY_BYTES) {
    throw new ResonanceCryptoError(
      `Encryption key must be ${KEY_BYTES} bytes (base64-encoded), got ${raw.length} bytes`,
    )
  }
  return globalThis.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 加密明文为 base64(iv ‖ ciphertext ‖ tag)。 */
export async function encryptSecret(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encoded = new TextEncoder().encode(plaintext)
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  )
  const cipherBytes = new Uint8Array(cipher)
  const combined = new Uint8Array(IV_BYTES + cipherBytes.length)
  combined.set(iv, 0)
  combined.set(cipherBytes, IV_BYTES)
  return bytesToBase64(combined)
}

/** 解密 base64(iv ‖ ciphertext ‖ tag) 为明文；tag 校验失败即抛 ResonanceCryptoError。 */
export async function decryptSecret(
  ciphertextBase64: string,
  key: CryptoKey,
): Promise<string> {
  const combined = base64ToBytes(ciphertextBase64)
  // GCM tag 固定 16 字节，密文至少 iv + 1 字节明文 + tag
  if (combined.length < IV_BYTES + 16) {
    throw new ResonanceCryptoError('Ciphertext too short to contain iv and tag')
  }
  const iv = combined.slice(0, IV_BYTES)
  const cipher = combined.slice(IV_BYTES)
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher,
  )
  return new TextDecoder().decode(plain)
}
