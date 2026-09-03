// @aether/web · SCIM 2.0 ServiceProviderConfig 端点
// GET /api/scim/v2/ServiceProviderConfig — 向 IdP 声明能力（patch / filter / paging）。
import { handleServiceProviderConfig } from '@/lib/scim/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return handleServiceProviderConfig(request)
}
