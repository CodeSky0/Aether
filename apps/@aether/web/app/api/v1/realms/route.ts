// @aether/web · Resonance Gateway — Realms 列表
// GET /api/v1/realms — 密钥绑定 Realm（单元素数组）
import { handleListRealms } from '@/lib/resonance/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return handleListRealms(request)
}
