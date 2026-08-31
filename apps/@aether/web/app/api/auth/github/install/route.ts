// @aether/web · GitHub App 安装入口
// GET /api/auth/github/install?realmId=xxx
// 校验登录 + Realm admin 权限后，重定向到 GitHub App 安装页，state=realmId。
// GitHub 安装完成后回调 /api/auth/github/callback。
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { resolveCurrentActor, requireEntitlement } from '@/lib/auth-guard'
import {
  MANAGE_MEMBER_ROLES,
  requireRealmRole,
} from '@/lib/membership-guard'
import { requireGithubAppConfig } from '@/lib/github'
import { createLogger } from '@/lib/logger'

const logger = createLogger('github-install')

export const dynamic = 'force-dynamic'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest): Promise<Response> {
  const realmId = new URL(request.url).searchParams.get('realmId')
  if (!realmId || !UUID_REGEX.test(realmId)) {
    return Response.json(
      { error: 'Invalid or missing realmId' },
      { status: 400 },
    )
  }

  const actor = await resolveCurrentActor()
  if (actor === null) {
    return Response.json(
      { error: 'GitHub integration requires an authenticated session' },
      { status: 401 },
    )
  }

  let appConfig
  try {
    appConfig = requireGithubAppConfig()
  } catch (error) {
    logger.error('GitHub App not configured', { error })
    return Response.json(
      { error: 'GitHub integration is not configured on this server' },
      { status: 503 },
    )
  }

  try {
    await requireEntitlement(realmId, { resource: 'realm', action: 'update' })
    await requireRealmRole(realmId, actor, MANAGE_MEMBER_ROLES)
  } catch {
    return Response.json(
      { error: 'Insufficient permissions to manage Realm integrations' },
      { status: 403 },
    )
  }

  // state=realmId：GitHub 原样回传。callback 重新校验 actor 对 realmId 的权限，防 CSRF。
  const installUrl = `https://github.com/apps/${encodeURIComponent(appConfig.appSlug)}/installations/new?state=${encodeURIComponent(realmId)}`
  return NextResponse.redirect(installUrl)
}
