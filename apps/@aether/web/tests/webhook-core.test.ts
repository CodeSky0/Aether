// @aether/resonance Webhook Constellation 纯函数层测试
// 覆盖：事件目录守卫、secret 生成、HMAC-SHA256 签名（GitHub
// X-Hub-Signature-256 同构协议，含 node:crypto 已知向量交叉验证）、
// 指数退避、投递请求头、AES-GCM secret 加解密往返。
import { createHmac, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  MAX_WEBHOOK_ATTEMPTS,
  WEBHOOK_BACKOFF_BASE_MS,
  WEBHOOK_BACKOFF_CAP_MS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SECRET_PREFIX,
  buildWebhookHeaders,
  computeWebhookBackoffMs,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  importAesKey,
  isWebhookEventSelection,
  isWebhookEventType,
  signWebhookPayload,
  verifyWebhookSignature,
} from '@aether/resonance'

describe('事件目录', () => {
  it('v1 目录含三类核心事件', () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      'thread.created',
      'thread.status_changed',
      'dialogue.message_created',
    ])
  })

  it('isWebhookEventType 只认目录内类型', () => {
    expect(isWebhookEventType('thread.created')).toBe(true)
    expect(isWebhookEventType('thread.deleted')).toBe(false)
    expect(isWebhookEventType(null)).toBe(false)
    expect(isWebhookEventType(42)).toBe(false)
  })

  it('isWebhookEventSelection 额外接受通配符 "*"', () => {
    expect(isWebhookEventSelection('*')).toBe(true)
    expect(isWebhookEventSelection('dialogue.message_created')).toBe(true)
    expect(isWebhookEventSelection('**')).toBe(false)
    expect(isWebhookEventSelection('')).toBe(false)
  })
})

describe('签名密钥生成', () => {
  it('格式为 whsec_<base64url(32B)>，且每次不同', () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true)
    expect(b.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true)
    expect(a).not.toBe(b)
    // 32 字节 base64url 编码 ≈ 43 字符（无 padding）
    expect(a.length).toBe(WEBHOOK_SECRET_PREFIX.length + 43)
  })
})

describe('HMAC-SHA256 签名', () => {
  const secret = 'whsec_known_secret_for_test'
  const body = JSON.stringify({
    type: 'thread.created',
    data: { thread_id: 't-1' },
  })

  it('签名格式 sha256=<hex>，与 node:crypto 交叉验证一致', async () => {
    const signature = await signWebhookPayload(secret, body)
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)

    const expected = createHmac('sha256', secret).update(body).digest('hex')
    expect(signature).toBe(`sha256=${expected}`)
  })

  it('签名随 body 变化（防篡改）', async () => {
    const sigA = await signWebhookPayload(secret, body)
    const sigB = await signWebhookPayload(secret, `${body} `)
    expect(sigA).not.toBe(sigB)
  })

  it('verifyWebhookSignature：正确签名通过，错误 secret / 篡改签名拒绝', async () => {
    const signature = await signWebhookPayload(secret, body)
    await expect(verifyWebhookSignature(secret, body, signature)).resolves.toBe(
      true,
    )
    await expect(
      verifyWebhookSignature('whsec_other_secret', body, signature),
    ).resolves.toBe(false)
    await expect(
      verifyWebhookSignature(secret, body, `sha256=${'0'.repeat(64)}`),
    ).resolves.toBe(false)
    // 长度不同的签名直接拒绝（safeEqual 早退分支）
    await expect(verifyWebhookSignature(secret, body, 'sha256=short')).resolves
      .toBe(false)
  })
})

describe('指数退避', () => {
  it('30s 基准，每次失败翻倍，1h 封顶', () => {
    expect(computeWebhookBackoffMs(1)).toBe(30_000)
    expect(computeWebhookBackoffMs(2)).toBe(60_000)
    expect(computeWebhookBackoffMs(3)).toBe(120_000)
    expect(computeWebhookBackoffMs(6)).toBe(960_000)
    expect(computeWebhookBackoffMs(7)).toBe(1_920_000)
    expect(computeWebhookBackoffMs(8)).toBe(WEBHOOK_BACKOFF_CAP_MS)
    expect(computeWebhookBackoffMs(20)).toBe(WEBHOOK_BACKOFF_CAP_MS)
  })

  it('防御式：非有限数或 < 1 回退基准间隔', () => {
    expect(computeWebhookBackoffMs(0)).toBe(WEBHOOK_BACKOFF_BASE_MS)
    expect(computeWebhookBackoffMs(-3)).toBe(WEBHOOK_BACKOFF_BASE_MS)
    expect(computeWebhookBackoffMs(Number.NaN)).toBe(WEBHOOK_BACKOFF_BASE_MS)
    expect(computeWebhookBackoffMs(Number.POSITIVE_INFINITY)).toBe(
      WEBHOOK_BACKOFF_BASE_MS,
    )
    // 小数向下取整（1.9 → 第 1 档）
    expect(computeWebhookBackoffMs(1.9)).toBe(30_000)
  })

  it('8 次尝试的总重试窗口约 2 小时', () => {
    let total = 0
    for (let attempt = 1; attempt < MAX_WEBHOOK_ATTEMPTS; attempt++) {
      total += computeWebhookBackoffMs(attempt)
    }
    // 30s+1m+2m+4m+8m+16m+32m = 63.5 分钟；封顶后第 8 次再等 1h
    expect(total).toBe(3_810_000)
  })
})

describe('投递请求头', () => {
  it('携带事件 / 幂等键 / 订阅 id / 时间戳 / 签名', () => {
    const headers = buildWebhookHeaders({
      deliveryId: 'delivery-1',
      subscriptionId: 'sub-1',
      eventType: 'thread.created',
      timestamp: 1_770_000_000,
      signature: 'sha256=abc',
    })
    expect(headers).toEqual({
      'content-type': 'application/json',
      'user-agent': 'aether-webhooks/1',
      'x-aether-event': 'thread.created',
      'x-aether-delivery': 'delivery-1',
      'x-aether-hook-id': 'sub-1',
      'x-aether-timestamp': '1770000000',
      'x-aether-signature-256': 'sha256=abc',
    })
  })
})

describe('AES-GCM secret 加解密（投递时解密存储密钥）', () => {
  async function makeKey(): Promise<{ base64: string; key: CryptoKey }> {
    const base64 = randomBytes(32).toString('base64')
    return { base64, key: await importAesKey(base64) }
  }

  it('往返一致，密文不含明文', async () => {
    const { key } = await makeKey()
    const secret = generateWebhookSecret()
    const encrypted = await encryptSecret(secret, key)
    expect(encrypted).not.toContain(secret.slice(WEBHOOK_SECRET_PREFIX.length))
    await expect(decryptSecret(encrypted, key)).resolves.toBe(secret)
  })

  it('同一明文两次加密产生不同密文（随机 iv）', async () => {
    const { key } = await makeKey()
    const a = await encryptSecret('whsec_x', key)
    const b = await encryptSecret('whsec_x', key)
    expect(a).not.toBe(b)
  })

  it('密钥不匹配（轮换后）→ GCM tag 校验失败抛错', async () => {
    const { key } = await makeKey()
    const other = await makeKey()
    const encrypted = await encryptSecret('whsec_x', key)
    await expect(decryptSecret(encrypted, other.key)).rejects.toThrow()
  })

  it('密文过短（缺失 iv/tag）→ 拒绝解密', async () => {
    const { key } = await makeKey()
    await expect(decryptSecret('AAAA', key)).rejects.toThrow()
  })

  it('加密密钥长度不符 → importAesKey 抛错', async () => {
    const short = randomBytes(16).toString('base64')
    await expect(importAesKey(short)).rejects.toThrow(/32 bytes/)
  })
})
