// Webhook Constellation 协议层测试（lib/webhooks/protocol.ts）
// 覆盖：创建输入校验（https 限定 / 事件目录 / 边界长度）、事件归一化、
// 订阅与投递资源映射（snake_case + ISO 时间戳 + 可选字段收敛）。
import { describe, expect, it } from 'vitest'

import {
  createWebhookInputSchema,
  normalizeWebhookEvents,
  toWebhookDeliveryResource,
  toWebhookSubscriptionResource,
} from '@/lib/webhooks/protocol'

const NOW = new Date('2026-09-01T00:00:00.000Z')

describe('createWebhookInputSchema', () => {
  it('合法输入通过并保留全部字段', () => {
    const parsed = createWebhookInputSchema.safeParse({
      name: 'CI 通知',
      url: 'https://ci.example.com/hooks/aether',
      events: ['thread.created', 'thread.status_changed'],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.name).toBe('CI 通知')
      expect(parsed.data.url).toBe('https://ci.example.com/hooks/aether')
      expect(parsed.data.events).toEqual([
        'thread.created',
        'thread.status_changed',
      ])
    }
  })

  it('name：空白 / 超长拒绝', () => {
    expect(
      createWebhookInputSchema.safeParse({
        name: '   ',
        url: 'https://a.dev',
        events: ['*'],
      }).success,
    ).toBe(false)
    expect(
      createWebhookInputSchema.safeParse({
        name: 'x'.repeat(101),
        url: 'https://a.dev',
        events: ['*'],
      }).success,
    ).toBe(false)
  })

  it('url：http / 非法 URL / 超长拒绝（仅 https）', () => {
    for (const url of [
      'http://insecure.example.com',
      'ftp://files.example.com',
      'not-a-url',
      `https://a.dev/${'p'.repeat(2100)}`,
    ]) {
      expect(
        createWebhookInputSchema.safeParse({
          name: 'n',
          url,
          events: ['*'],
        }).success,
      ).toBe(false)
    }
  })

  it('events：空数组 / 目录外类型 / 通配符与具体类型混用均合法', () => {
    expect(
      createWebhookInputSchema.safeParse({
        name: 'n',
        url: 'https://a.dev',
        events: [],
      }).success,
    ).toBe(false)
    expect(
      createWebhookInputSchema.safeParse({
        name: 'n',
        url: 'https://a.dev',
        events: ['thread.exploded'],
      }).success,
    ).toBe(false)
    // 通配符与具体类型混用是合法输入（归一化时收敛为 ["*"]）
    expect(
      createWebhookInputSchema.safeParse({
        name: 'n',
        url: 'https://a.dev',
        events: ['*', 'thread.created'],
      }).success,
    ).toBe(true)
  })
})

describe('normalizeWebhookEvents', () => {
  it('去重保序', () => {
    expect(
      normalizeWebhookEvents(['thread.created', 'thread.created', 'a', 'a']),
    ).toEqual(['thread.created', 'a'])
  })

  it('含通配符时收敛为 ["*"]', () => {
    expect(normalizeWebhookEvents(['thread.created', '*'])).toEqual(['*'])
    expect(normalizeWebhookEvents(['*'])).toEqual(['*'])
  })
})

describe('toWebhookSubscriptionResource', () => {
  it('snake_case + ISO 时间戳，绝不含明文 secret', () => {
    const resource = toWebhookSubscriptionResource({
      id: 'sub-1',
      realm_id: 'realm-1',
      name: 'CI',
      url: 'https://ci.example.com/hook',
      events: ['thread.created'],
      secret_prefix: 'whsec_abc1',
      created_at: NOW,
      updated_at: NOW,
    })
    expect(resource).toEqual({
      id: 'sub-1',
      realm_id: 'realm-1',
      name: 'CI',
      url: 'https://ci.example.com/hook',
      events: ['thread.created'],
      secret_prefix: 'whsec_abc1',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    })
    expect(Object.keys(resource)).not.toContain('secret')
  })
})

describe('toWebhookDeliveryResource', () => {
  it('null 可选字段收敛为缺省键', () => {
    const resource = toWebhookDeliveryResource({
      id: 'd-1',
      subscription_id: 'sub-1',
      event_type: 'thread.created',
      status: 'pending',
      attempts: 0,
      last_response_status: null,
      last_error: null,
      created_at: NOW,
      delivered_at: null,
    })
    expect(resource).toEqual({
      id: 'd-1',
      subscription_id: 'sub-1',
      event_type: 'thread.created',
      status: 'pending',
      attempts: 0,
      created_at: NOW.toISOString(),
    })
  })

  it('非 null 可选字段全部透出', () => {
    const resource = toWebhookDeliveryResource({
      id: 'd-2',
      subscription_id: 'sub-1',
      event_type: 'thread.status_changed',
      status: 'succeeded',
      attempts: 2,
      last_response_status: 200,
      last_error: 'HTTP 503',
      created_at: NOW,
      delivered_at: NOW,
    })
    expect(resource).toEqual({
      id: 'd-2',
      subscription_id: 'sub-1',
      event_type: 'thread.status_changed',
      status: 'succeeded',
      attempts: 2,
      last_response_status: 200,
      last_error: 'HTTP 503',
      created_at: NOW.toISOString(),
      delivered_at: NOW.toISOString(),
    })
  })
})
