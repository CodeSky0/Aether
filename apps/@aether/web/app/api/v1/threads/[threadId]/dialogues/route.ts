// @aether/web · Resonance Gateway — Thread 对话历史
// GET  /api/v1/threads/:threadId/dialogues — 消息列表（after 游标）
// POST /api/v1/threads/:threadId/dialogues — 追加消息
import {
  handleCreateDialogue,
  handleListDialogues,
} from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ threadId: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { threadId } = await context.params
  return handleListDialogues(request, threadId)
}

export async function POST(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { threadId } = await context.params
  return handleCreateDialogue(request, threadId)
}
