// @aether/web · Resonance Gateway — Realm 详情
// GET /api/v1/realms/:realmId
import { handleGetRealm } from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ realmId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { realmId } = await context.params
  return handleGetRealm(request, realmId)
}
