// @aether/web · Resonance Gateway — Threads 列表与创建
// GET  /api/v1/realms/:realmId/threads — 列表（status 过滤 + limit/offset 分页）
// POST /api/v1/realms/:realmId/threads — 创建
import {
  handleCreateThread,
  handleListThreads,
} from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ realmId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { realmId } = await context.params
  return handleListThreads(request, realmId)
}

export async function POST(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { realmId } = await context.params
  return handleCreateThread(request, realmId)
}
