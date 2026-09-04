// @aether/web · Resonance Gateway — Currents 列表
// GET /api/v1/realms/:realmId/currents — presence 快照与连接状态
import { handleListCurrents } from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ realmId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { realmId } = await context.params
  return handleListCurrents(request, realmId)
}
