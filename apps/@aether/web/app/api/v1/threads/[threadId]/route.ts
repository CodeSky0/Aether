// @aether/web · Resonance Gateway — Thread 详情与更新
// GET   /api/v1/threads/:threadId — 详情（含 code_anchor）
// PATCH /api/v1/threads/:threadId — 状态迁移 / manifestation_url 绑定
import { handleGetThread, handlePatchThread } from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ threadId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { threadId } = await context.params
  return handleGetThread(request, threadId)
}

export async function PATCH(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { threadId } = await context.params
  return handlePatchThread(request, threadId)
}
