// @aether/web · Resonance Gateway 端点发现入口
// GET /api/v1 — 版本与资源链接自描述（需 API Key 鉴权）
import { handleApiIndex } from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return handleApiIndex(request)
}
