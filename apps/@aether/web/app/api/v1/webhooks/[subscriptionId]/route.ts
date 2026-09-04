// @aether/web · Webhook Constellation 订阅删除端点
// DELETE /api/v1/webhooks/:subscriptionId — 软删除订阅 → 204
import { handleDeleteWebhook } from '@/lib/webhooks/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ subscriptionId: string }>
}

export async function DELETE(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { subscriptionId } = await context.params
  return handleDeleteWebhook(request, subscriptionId)
}
