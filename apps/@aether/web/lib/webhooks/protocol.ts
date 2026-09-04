// @aether/web · Webhook Constellation 协议层
// 纯函数：订阅输入校验、订阅 / 投递资源映射。
// 复用 resonance 协议层的响应构造与分页（同一公开 API 门面）。
import { z } from 'zod'
import {
  WEBHOOK_ALL_EVENTS,
  WEBHOOK_EVENT_TYPES,
  isWebhookEventSelection,
} from '@aether/resonance'

// ---- 输入 schema ----

export const createWebhookInputSchema = z.object({
  name: z.string().trim().min(1, 'name 不能为空').max(100, 'name 最长 100 字符'),
  url: z
    .url('url 必须是合法 URL')
    .refine((value) => value.startsWith('https://'), {
      message: 'url 仅接受 https（杜绝明文回流出站）',
    })
    .refine((value) => value.length <= 2048, {
      message: 'url 最长 2048 字符',
    }),
  events: z
    .array(z.string())
    .min(1, 'events 至少包含一个事件类型')
    .refine((items) => items.every((item) => isWebhookEventSelection(item)), {
      message: `events 仅接受 ${WEBHOOK_EVENT_TYPES.join(' / ')} 或 "${WEBHOOK_ALL_EVENTS}"`,
    }),
})
export type CreateWebhookInput = z.infer<typeof createWebhookInputSchema>

/** 归一化事件选择：去重保序；含通配符时收敛为 ["*"]。 */
export function normalizeWebhookEvents(events: string[]): string[] {
  if (events.includes(WEBHOOK_ALL_EVENTS)) return [WEBHOOK_ALL_EVENTS]
  return [...new Set(events)]
}

// ---- 资源映射（DB 行 → 公开 JSON，snake_case，ISO 时间戳）----

function iso(value: Date): string {
  return value.toISOString()
}

export interface WebhookSubscriptionRecord {
  id: string
  realm_id: string
  name: string
  url: string
  events: unknown
  secret_prefix: string
  created_at: Date
  updated_at: Date
}

/** 订阅资源：含 secret_prefix 供识别；明文 secret 绝不出现在此映射。 */
export function toWebhookSubscriptionResource(
  subscription: WebhookSubscriptionRecord,
): Record<string, unknown> {
  return {
    id: subscription.id,
    realm_id: subscription.realm_id,
    name: subscription.name,
    url: subscription.url,
    events: subscription.events,
    secret_prefix: subscription.secret_prefix,
    created_at: iso(subscription.created_at),
    updated_at: iso(subscription.updated_at),
  }
}

export interface WebhookDeliveryRecord {
  id: string
  subscription_id: string
  event_type: string
  status: string
  attempts: number
  last_response_status: number | null
  last_error: string | null
  created_at: Date
  delivered_at: Date | null
}

export function toWebhookDeliveryResource(
  delivery: WebhookDeliveryRecord,
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    id: delivery.id,
    subscription_id: delivery.subscription_id,
    event_type: delivery.event_type,
    status: delivery.status,
    attempts: delivery.attempts,
    created_at: iso(delivery.created_at),
  }
  if (delivery.last_response_status !== null) {
    resource.last_response_status = delivery.last_response_status
  }
  if (delivery.last_error !== null) {
    resource.last_error = delivery.last_error
  }
  if (delivery.delivered_at !== null) {
    resource.delivered_at = iso(delivery.delivered_at)
  }
  return resource
}
