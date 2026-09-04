// @aether/web · Resonance Gateway — Projects 列表
// GET /api/v1/realms/:realmId/projects
import { handleListProjects } from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ realmId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { realmId } = await context.params
  return handleListProjects(request, realmId)
}
