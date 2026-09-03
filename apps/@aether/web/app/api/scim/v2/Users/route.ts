// @aether/web · SCIM 2.0 Users 集合端点
// GET  /api/scim/v2/Users — 列成员（userName eq 过滤 + 分页）
// POST /api/scim/v2/Users — 建用户 + 开通成员
import { handleCreateUser, handleListUsers } from '@/lib/scim/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return handleListUsers(request)
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateUser(request)
}
