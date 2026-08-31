// @aether/resonance · Base64 / Base64URL 编码工具
// Node 22 与 Edge runtime 均提供全局 atob/btoa；不依赖 Buffer 以兼容 Edge。
// Resonance 凭据加密与 GitHub JWT 签名共用本模块。

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

/**
 * 拷贝为独立 ArrayBuffer。Web Crypto importKey 期望 BufferSource（纯 ArrayBuffer），
 * 而 Uint8Array 底层可能是 ArrayBufferLike；本 helper 保证返回 ArrayBuffer。
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
