// @aether/web · SCIM 2.0 单用户端点
// GET    /api/scim/v2/Users/:id — 查成员
// PATCH  /api/scim/v2/Users/:id — 启用 / 禁用（active）与 displayName
// DELETE /api/scim/v2/Users/:id — 回收成员
import {
  handleDeleteUser,
  handleGetUser,
  handlePatchUser,
} from '@/lib/scim/service'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { id } = await context.params
  return handleGetUser(request, id)
}

export async function PATCH(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { id } = await context.params
  return handlePatchUser(request, id)
}

export async function DELETE(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const { id } = await context.params
  return handleDeleteUser(request, id)
}
