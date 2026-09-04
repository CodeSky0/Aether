// @aether/web · Webhook Constellation 订阅端点
// GET  /api/v1/realms/:realmId/webhooks — 订阅列表（含 secret_prefix）
// POST /api/v1/realms/:realmId/webhooks — 创建订阅（secret 明文仅此一次返回）
import { handleCreateWebhook, handleListWebhooks } from '@/lib/webhooks/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ realmId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { realmId } = await context.params
  return handleListWebhooks(request, realmId)
}

export async function POST(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { realmId } = await context.params
  return handleCreateWebhook(request, realmId)
}
