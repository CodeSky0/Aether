// @aether/web · GitHub App Webhook 监听端点
// POST /api/webhooks/github
// 职责：HMAC-SHA256 验签 → 解析事件 → 分发到 lib/github-webhook 映射层。
// 验签密钥：AETHER_GITHUB_WEBHOOK_SECRET（创建 GitHub App 时设置）。
// 这是服务器到服务器调用，不做用户会话校验；签名即身份证明。
import type { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getGithubWebhookSecret } from '@/lib/github'
import { handleGithubEvent } from '@/lib/github-webhook'
import { createLogger } from '@/lib/logger'

const logger = createLogger('github-webhook-route')

export const dynamic = 'force-dynamic'

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** constant-time 字符串比较，防时序攻击。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const expected = `sha256=${bytesToHex(new Uint8Array(sig))}`
  return safeEqual(expected, signatureHeader)
}

export async function POST(request: NextRequest): Promise<Response> {
  const secret = getGithubWebhookSecret()
  if (!secret) {
    logger.error('webhook secret not configured')
    return Response.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const event = request.headers.get('x-github-event')

  if (!event) {
    return Response.json({ error: 'Missing X-GitHub-Event header' }, { status: 400 })
  }

  const valid = await verifySignature(rawBody, signature, secret)
  if (!valid) {
    logger.warn('webhook signature verification failed', { event })
    return Response.json({ error: 'Signature verification failed' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const result = await handleGithubEvent({
    db: getDb(),
    event,
    payload,
  })

  logger.info('webhook processed', { event, status: result.status, reason: result.reason })
  return Response.json({ ok: true, ...result })
}
