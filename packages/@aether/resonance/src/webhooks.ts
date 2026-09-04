// @aether/resonance · Webhook Constellation 纯函数层
// 事件目录、签名密钥生成、HMAC-SHA256 签名（镜像 GitHub X-Hub-Signature-256
// 协议）、指数退避调度。运行时无关：仅依赖 Web Crypto（Node 22 与 Edge 均内建）。

import { bytesToBase64Url, toArrayBuffer } from './encoding'

// ---- 事件目录 ----

/** v1 事件目录：新增类型追加于此（订阅方按目录校验）。 */
export const WEBHOOK_EVENT_TYPES = [
  'thread.created',
  'thread.status_changed',
  'dialogue.message_created',
] as const
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

/** 通配符：订阅全部事件（含未来新增类型）。 */
export const WEBHOOK_ALL_EVENTS = '*'
export type WebhookEventSelection = WebhookEventType | typeof WEBHOOK_ALL_EVENTS

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return (
    typeof value === 'string' &&
    (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value)
  )
}

/** 订阅 events 数组的合法元素：目录内类型或通配符。 */
export function isWebhookEventSelection(
  value: unknown,
): value is WebhookEventSelection {
  return value === WEBHOOK_ALL_EVENTS || isWebhookEventType(value)
}

// ---- 签名密钥 ----

export const WEBHOOK_SECRET_PREFIX = 'whsec_'
const SECRET_BYTES = 32

/** 生成订阅签名密钥：whsec_<base64url(32B)>；明文仅创建时返回一次，绝不入库。 */
export function generateWebhookSecret(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
  return `${WEBHOOK_SECRET_PREFIX}${bytesToBase64Url(bytes)}`
}

// ---- HMAC-SHA256 签名 ----

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret)
  return globalThis.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** 签名原始请求体：sha256=<hex(HMAC-SHA256(secret, body))>。 */
export async function signWebhookPayload(
  secret: string,
  body: string,
): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body),
  )
  return `sha256=${bytesToHex(new Uint8Array(sig))}`
}

/** 恒时字符串比较，防时序攻击（与入站 GitHub webhook 验签同构）。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/** 校验签名（接收方视角）：恒时比较，杜绝时序侧信道。 */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const expected = await signWebhookPayload(secret, body)
  return safeEqual(expected, signature)
}

// ---- 重试策略 ----

export const MAX_WEBHOOK_ATTEMPTS = 8
export const WEBHOOK_BACKOFF_BASE_MS = 30_000
export const WEBHOOK_BACKOFF_CAP_MS = 60 * 60_000

/**
 * 第 attempts 次失败后的下次可投递间隔：30s × 2^(attempts-1)，上限 1h
 * （30s / 1m / 2m / 4m / 8m / 16m / 32m / 64m，总窗口约 2h）。
 * 非有限数或 < 1 的输入回退基准间隔（防御式，正常调用方传入计数器整数）。
 */
export function computeWebhookBackoffMs(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts < 1) {
    return WEBHOOK_BACKOFF_BASE_MS
  }
  const ms = WEBHOOK_BACKOFF_BASE_MS * 2 ** (Math.floor(attempts) - 1)
  return Math.min(ms, WEBHOOK_BACKOFF_CAP_MS)
}

// ---- 投递请求头 ----

export interface WebhookHeadersInput {
  deliveryId: string
  subscriptionId: string
  eventType: string
  /** Unix 秒；接收方可做重放窗口校验。 */
  timestamp: number
  /** signWebhookPayload 输出。 */
  signature: string
}

/**
 * 构造投递请求头。x-aether-delivery 是接收方幂等去重键
 * （at-least-once 语义下可能收到重复投递）。
 */
export function buildWebhookHeaders(
  input: WebhookHeadersInput,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'user-agent': 'aether-webhooks/1',
    'x-aether-event': input.eventType,
    'x-aether-delivery': input.deliveryId,
    'x-aether-hook-id': input.subscriptionId,
    'x-aether-timestamp': String(input.timestamp),
    'x-aether-signature-256': input.signature,
  }
}
