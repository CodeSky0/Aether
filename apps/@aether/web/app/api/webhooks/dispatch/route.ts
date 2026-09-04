// @aether/web · Webhook Constellation 投递扫描端点（Cron 触发）
// POST /api/webhooks/dispatch — 领取到期 pending 投递并逐条签名投递。
// 鉴权：Bearer AETHER_WEBHOOK_DISPATCH_TOKEN（未配置 503 fail-closed，
// 绝不开放无鉴权的投递触发端点）。Vercel Cron 自动向 cron 路径发送
// Authorization: Bearer $CRON_SECRET —— 部署时将 CRON_SECRET 设为同值即可。
import { createLogger } from '@/lib/logger'
import {
  dispatchPendingWebhooks,
  verifyDispatchAuthorization,
} from '@/lib/webhooks/service'

export const dynamic = 'force-dynamic'

const logger = createLogger('webhooks:dispatch')

export async function POST(request: Request): Promise<Response> {
  const authorization = verifyDispatchAuthorization(
    request.headers.get('authorization'),
  )
  if (authorization === 'unconfigured') {
    logger.error('dispatch token not configured')
    return Response.json(
      { error: 'Dispatch token not configured' },
      { status: 503 },
    )
  }
  if (authorization === 'unauthorized') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await dispatchPendingWebhooks()
  logger.info('webhook dispatch sweep', { ...summary })
  return Response.json({ ok: true, ...summary })
}
