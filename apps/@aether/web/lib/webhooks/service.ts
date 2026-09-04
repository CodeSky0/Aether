// @aether/web · Webhook Constellation 服务层
// 职责：订阅 CRUD（API Key member 级）+ 事务性 outbox 入队 + Cron 扫描投递。
// 投递语义 at-least-once：接收方按 x-aether-delivery（delivery id）幂等去重。
// 签名密钥明文绝不入库（AES-GCM 加密存储），绝不落日志与审计 target。
// 禁止 import 任何 'use server' 模块（与 Resonance Gateway 同一戒律）。
import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'

import {
  WEBHOOK_ALL_EVENTS,
  MAX_WEBHOOK_ATTEMPTS,
  buildWebhookHeaders,
  computeWebhookBackoffMs,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  importAesKey,
  signWebhookPayload,
  type WebhookEventType,
} from '@aether/resonance'
import {
  realms,
  webhookDeliveries,
  webhookSubscriptions,
} from '@aether/db'
import { getDb } from '@/lib/db'
import { recordAuditEntry } from '@/lib/audit-write'
import { getIntegrationEncryptionKey } from '@/lib/github'
import {
  apiKeyActor,
  authorizeRequest,
  requireRealmMatch,
} from '@/lib/resonance/auth'
import { isResponse, readJsonBody, runHandler } from '@/lib/resonance/http'
import {
  apiError,
  apiJson,
  notFound,
  parseOffsetPagination,
  toOffsetPaginated,
  zodBadRequest,
} from '@/lib/resonance/protocol'
import {
  createWebhookInputSchema,
  normalizeWebhookEvents,
  toWebhookDeliveryResource,
  toWebhookSubscriptionResource,
} from './protocol'

type Database = ReturnType<typeof getDb>
type WebhookTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0]

const LAST_ERROR_MAX_LENGTH = 500

function truncateError(message: string): string {
  return message.length > LAST_ERROR_MAX_LENGTH
    ? `${message.slice(0, LAST_ERROR_MAX_LENGTH)}…`
    : message
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'unknown error'
}

// ---- 事务性 outbox（事件入队）----

export interface EnqueueWebhookEventsInput {
  realmId: string
  eventType: WebhookEventType
  data: Record<string, unknown>
}

/**
 * 事件入队：与业务变更同事务调用（transactional outbox）——业务回滚则
 * 投递行一并回滚，不产生幻影事件。为每个匹配订阅（realm 匹配 + 未删除 +
 * events 含该类型或 "*"）插入一条 pending 投递。无匹配订阅时零写入。
 */
export async function enqueueWebhookDeliveries(
  tx: WebhookTransaction,
  input: EnqueueWebhookEventsInput,
): Promise<void> {
  const subscriptions = await tx
    .select({ id: webhookSubscriptions.id })
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.realm_id, input.realmId),
        isNull(webhookSubscriptions.deleted_at),
        or(
          sql`${webhookSubscriptions.events} @> ${JSON.stringify([input.eventType])}::jsonb`,
          sql`${webhookSubscriptions.events} @> ${JSON.stringify([WEBHOOK_ALL_EVENTS])}::jsonb`,
        ),
      ),
    )
  if (subscriptions.length === 0) return

  // 事件信封携带 realm slug（主键小查询；仅在确有订阅时发生）
  const [realmRow] = await tx
    .select({ slug: realms.slug })
    .from(realms)
    .where(eq(realms.id, input.realmId))
    .limit(1)

  const payload = {
    type: input.eventType,
    created_at: new Date().toISOString(),
    realm: { id: input.realmId, slug: realmRow?.slug ?? null },
    data: input.data,
  }
  await tx.insert(webhookDeliveries).values(
    subscriptions.map((subscription) => ({
      subscription_id: subscription.id,
      realm_id: input.realmId,
      event_type: input.eventType,
      payload,
      status: 'pending' as const,
      next_attempt_at: new Date(),
    })),
  )
}

// ---- 订阅管理（/api/v1）----

// ---- GET /api/v1/realms/{realmId}/webhooks ----

export async function handleListWebhooks(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleListWebhooks', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch

    const rows = await getDb()
      .select({
        id: webhookSubscriptions.id,
        realm_id: webhookSubscriptions.realm_id,
        name: webhookSubscriptions.name,
        url: webhookSubscriptions.url,
        events: webhookSubscriptions.events,
        secret_prefix: webhookSubscriptions.secret_prefix,
        created_at: webhookSubscriptions.created_at,
        updated_at: webhookSubscriptions.updated_at,
      })
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.realm_id, realmId),
          isNull(webhookSubscriptions.deleted_at),
        ),
      )
      .orderBy(desc(webhookSubscriptions.created_at))
    return apiJson({
      data: rows.map((row) => toWebhookSubscriptionResource(row)),
    })
  })
}

// ---- POST /api/v1/realms/{realmId}/webhooks ----

export async function handleCreateWebhook(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleCreateWebhook', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch

    const body = await readJsonBody(request)
    if (isResponse(body)) return body
    const parsed = createWebhookInputSchema.safeParse(body)
    if (!parsed.success) return zodBadRequest(parsed.error)

    const encryptionKeyBase64 = getIntegrationEncryptionKey()
    if (encryptionKeyBase64 === null) {
      return apiError(
        503,
        'service_unavailable',
        'Webhook subscriptions are unavailable: encryption key is not configured.',
      )
    }
    const aesKey = await importAesKey(encryptionKeyBase64)
    const secret = generateWebhookSecret()
    const encryptedSecret = await encryptSecret(secret, aesKey)
    const events = normalizeWebhookEvents(parsed.data.events)

    const created = await getDb().transaction(async (tx) => {
      const [row] = await tx
        .insert(webhookSubscriptions)
        .values({
          realm_id: realmId,
          name: parsed.data.name,
          url: parsed.data.url,
          events,
          encrypted_secret: encryptedSecret,
          secret_prefix: secret.slice(0, 12),
          created_by: context.key.creatorId,
        })
        .returning({
          id: webhookSubscriptions.id,
          realm_id: webhookSubscriptions.realm_id,
          name: webhookSubscriptions.name,
          url: webhookSubscriptions.url,
          events: webhookSubscriptions.events,
          secret_prefix: webhookSubscriptions.secret_prefix,
          created_at: webhookSubscriptions.created_at,
          updated_at: webhookSubscriptions.updated_at,
        })
      if (!row) throw new Error('Failed to create webhook subscription')
      await recordAuditEntry(tx, {
        realmId,
        actor: apiKeyActor(context.key),
        action: 'write',
        target: {
          kind: 'webhook_subscription',
          webhook_id: row.id,
          name: row.name,
          url: row.url,
          events: row.events,
          source: 'api-key',
        },
        idempotencyKey: `resonance:webhook.create:${row.id}`,
        result: { events: row.events },
      })
      return row
    })

    // 明文 secret 仅此一次返回（此后任何通道不可再取回）
    return apiJson(
      { ...toWebhookSubscriptionResource(created), secret },
      201,
    )
  })
}

// ---- DELETE /api/v1/webhooks/{subscriptionId} ----

export async function handleDeleteWebhook(
  request: Request,
  subscriptionId: string,
): Promise<Response> {
  return runHandler('handleDeleteWebhook', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const realmId = context.key.realm.id

    const [subscription] = await getDb()
      .select({
        id: webhookSubscriptions.id,
        realm_id: webhookSubscriptions.realm_id,
      })
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.id, subscriptionId),
          isNull(webhookSubscriptions.deleted_at),
        ),
      )
      .limit(1)
    // 不存在 / 跨 Realm / 已删除 一律 404（不泄露存在性）
    if (!subscription || subscription.realm_id !== realmId) {
      return notFound()
    }

    await getDb().transaction(async (tx) => {
      await tx
        .update(webhookSubscriptions)
        .set({ deleted_at: new Date(), updated_at: new Date() })
        .where(eq(webhookSubscriptions.id, subscriptionId))
      await recordAuditEntry(tx, {
        realmId,
        actor: apiKeyActor(context.key),
        action: 'write',
        target: {
          kind: 'webhook_subscription',
          webhook_id: subscriptionId,
          deleted: true,
          source: 'api-key',
        },
        idempotencyKey: `resonance:webhook.delete:${subscriptionId}`,
        result: { status: 'deleted' },
      })
    })
    return new Response(null, { status: 204 })
  })
}

// ---- GET /api/v1/webhooks/{subscriptionId}/deliveries ----

export async function handleListWebhookDeliveries(
  request: Request,
  subscriptionId: string,
): Promise<Response> {
  return runHandler('handleListWebhookDeliveries', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const realmId = context.key.realm.id

    const [subscription] = await getDb()
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.id, subscriptionId),
          eq(webhookSubscriptions.realm_id, realmId),
          isNull(webhookSubscriptions.deleted_at),
        ),
      )
      .limit(1)
    if (!subscription) return notFound()

    const pagination = parseOffsetPagination(
      new URL(request.url).searchParams,
    )
    const where = eq(webhookDeliveries.subscription_id, subscriptionId)
    const db = getDb()
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(where)
    const rows = await db
      .select({
        id: webhookDeliveries.id,
        subscription_id: webhookDeliveries.subscription_id,
        event_type: webhookDeliveries.event_type,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        last_response_status: webhookDeliveries.last_response_status,
        last_error: webhookDeliveries.last_error,
        created_at: webhookDeliveries.created_at,
        delivered_at: webhookDeliveries.delivered_at,
      })
      .from(webhookDeliveries)
      .where(where)
      .orderBy(desc(webhookDeliveries.created_at))
      .limit(pagination.limit)
      .offset(pagination.offset)

    return apiJson(
      toOffsetPaginated(
        rows.map((row) => toWebhookDeliveryResource(row)),
        countRow?.total ?? 0,
        pagination,
      ),
    )
  })
}

// ---- Cron 扫描投递（POST /api/webhooks/dispatch）----

/** dispatch 端点鉴权状态。 */
export type DispatchAuthorization =
  | 'ok'
  | 'unauthorized'
  | 'unconfigured'

/**
 * 校验 dispatch 端点 Bearer token（恒时比较，防时序攻击）。
 * 未配置 AETHER_WEBHOOK_DISPATCH_TOKEN 时返回 'unconfigured'（调用方 503，
 * fail-closed——绝不开放无鉴权的投递触发端点）。
 */
export function verifyDispatchAuthorization(
  authorization: string | null,
): DispatchAuthorization {
  const token = process.env.AETHER_WEBHOOK_DISPATCH_TOKEN?.trim()
  if (!token) return 'unconfigured'
  const expected = `Bearer ${token}`
  if (authorization === null) return 'unauthorized'
  if (authorization.length !== expected.length) return 'unauthorized'
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= authorization.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0 ? 'ok' : 'unauthorized'
}

export const WEBHOOK_DISPATCH_BATCH_SIZE = 25
const WEBHOOK_FETCH_TIMEOUT_MS = 10_000

export interface WebhookDispatchSummary {
  claimed: number
  succeeded: number
  retried: number
  exhausted: number
  canceled: number
}

interface DeliveryPatch {
  status: 'succeeded' | 'exhausted' | 'canceled' | 'pending'
  attempts: number
  next_attempt_at?: Date
  last_response_status?: number | null
  last_error?: string | null
  delivered_at?: Date
}

/**
 * 终态写入：带 status='pending' 守卫——并发扫描只认首次 finalize，
 * 重复投递收敛到 at-least-once 语义（接收方按 delivery id 去重）。
 */
async function finalizeDelivery(
  deliveryId: string,
  patch: DeliveryPatch,
): Promise<void> {
  await getDb()
    .update(webhookDeliveries)
    .set(patch)
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.status, 'pending'),
      ),
    )
}

interface PendingDeliveryRow {
  id: string
  attempts: number
  event_type: string
  payload: unknown
  subscription_id: string
  subscription_url: string
  subscription_deleted_at: Date | null
  encrypted_secret: string
}

async function retryOrExhaust(
  row: PendingDeliveryRow,
  now: Date,
  summary: WebhookDispatchSummary,
  responseStatus: number | null,
  error: string,
): Promise<void> {
  const attempts = row.attempts + 1
  const exhausted = attempts >= MAX_WEBHOOK_ATTEMPTS
  await finalizeDelivery(row.id, {
    attempts,
    status: exhausted ? 'exhausted' : 'pending',
    ...(exhausted
      ? {}
      : {
          next_attempt_at: new Date(
            now.getTime() + computeWebhookBackoffMs(attempts),
          ),
        }),
    last_response_status: responseStatus,
    last_error: truncateError(error),
  })
  if (exhausted) summary.exhausted += 1
  else summary.retried += 1
}

/**
 * 扫描并投递到期的 pending 投递：领取 ≤ WEBHOOK_DISPATCH_BATCH_SIZE 条 →
 * 解密 secret → HMAC 签名 → POST 回调 → 幂等 finalize。
 * 2xx 成功；非 2xx / 网络错误 / 超时按指数退避重试，达上限落 exhausted；
 * 订阅已删除落 canceled；secret 解密失败（env key 轮换）落 exhausted。
 */
export async function dispatchPendingWebhooks(
  now = new Date(),
): Promise<WebhookDispatchSummary> {
  const summary: WebhookDispatchSummary = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    exhausted: 0,
    canceled: 0,
  }

  const encryptionKeyBase64 = getIntegrationEncryptionKey()
  // 创建订阅即需加密密钥，未配置时不可能存在订阅；直接空转（路由层已 503）。
  if (encryptionKeyBase64 === null) return summary
  const aesKey = await importAesKey(encryptionKeyBase64)

  const rows = await getDb()
    .select({
      id: webhookDeliveries.id,
      attempts: webhookDeliveries.attempts,
      event_type: webhookDeliveries.event_type,
      payload: webhookDeliveries.payload,
      subscription_id: webhookDeliveries.subscription_id,
      subscription_url: webhookSubscriptions.url,
      subscription_deleted_at: webhookSubscriptions.deleted_at,
      encrypted_secret: webhookSubscriptions.encrypted_secret,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookSubscriptions,
      eq(webhookSubscriptions.id, webhookDeliveries.subscription_id),
    )
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.next_attempt_at, now),
      ),
    )
    .orderBy(asc(webhookDeliveries.next_attempt_at))
    .limit(WEBHOOK_DISPATCH_BATCH_SIZE)
  summary.claimed = rows.length

  for (const row of rows) {
    if (row.subscription_deleted_at !== null) {
      await finalizeDelivery(row.id, {
        attempts: row.attempts,
        status: 'canceled',
        last_error: 'subscription deleted',
      })
      summary.canceled += 1
      continue
    }

    let secret: string
    try {
      secret = await decryptSecret(row.encrypted_secret, aesKey)
    } catch (error) {
      await finalizeDelivery(row.id, {
        attempts: row.attempts,
        status: 'exhausted',
        last_error: truncateError(
          `secret decryption failed: ${errorMessage(error)}`,
        ),
      })
      summary.exhausted += 1
      continue
    }

    const body = JSON.stringify(row.payload)
    const signature = await signWebhookPayload(secret, body)
    const headers = buildWebhookHeaders({
      deliveryId: row.id,
      subscriptionId: row.subscription_id,
      eventType: row.event_type,
      timestamp: Math.floor(now.getTime() / 1000),
      signature,
    })
    try {
      const response = await fetch(row.subscription_url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
      })
      if (response.ok) {
        await finalizeDelivery(row.id, {
          attempts: row.attempts + 1,
          status: 'succeeded',
          last_response_status: response.status,
          last_error: null,
          delivered_at: now,
        })
        summary.succeeded += 1
      } else {
        await retryOrExhaust(
          row,
          now,
          summary,
          response.status,
          `HTTP ${response.status}`,
        )
      }
    } catch (error) {
      await retryOrExhaust(
        row,
        now,
        summary,
        null,
        `network error: ${errorMessage(error)}`,
      )
    }
  }
  return summary
}
