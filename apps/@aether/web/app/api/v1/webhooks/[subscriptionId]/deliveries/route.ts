// @aether/web · Webhook Constellation 投递历史端点
// GET /api/v1/webhooks/:subscriptionId/deliveries — 投递历史（limit/offset 分页）
import { handleListWebhookDeliveries } from '@/lib/webhooks/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ subscriptionId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { subscriptionId } = await context.params
  return handleListWebhookDeliveries(request, subscriptionId)
}
