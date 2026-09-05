// @aether/web · OAuth Token 端点 — POST /api/oauth/token
// 机密客户端 code 兑换（RFC 6749 §5.2 错误形状）：
//   非 JSON / 缺字段 → invalid_request（400）；
//   grant_type 非 authorization_code → unsupported_grant_type（400）；
//   其余校验全部下沉 exchangeToken（invalid_client 401 / invalid_grant 400）。
import { getDb } from '@/lib/db'
import { exchangeToken } from '@/lib/oauth/service'
import { oauthError, tokenRequestSchema } from '@/lib/oauth/protocol'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return oauthError(400, 'invalid_request', 'Request body must be JSON.')
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'grant_type' in body &&
    body.grant_type !== 'authorization_code'
  ) {
    return oauthError(400, 'unsupported_grant_type', 'Only authorization_code is supported.')
  }
  const parsed = tokenRequestSchema.safeParse(body)
  if (!parsed.success) {
    return oauthError(400, 'invalid_request', 'Request body is invalid.')
  }
  return exchangeToken(getDb(), parsed.data)
}
