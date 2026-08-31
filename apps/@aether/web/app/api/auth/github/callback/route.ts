// @aether/web · GitHub App 安装回调
// GET /api/auth/github/callback?installation_id=xxx&setup_action=install&state=realmId
// GitHub 安装/卸载后回调：重新校验登录 + Realm 权限（防 CSRF），upsert
// realm_integrations，重定向回 Realm 集成设置页。
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { resolveCurrentActor, requireEntitlement } from '@/lib/auth-guard'
import {
  MANAGE_MEMBER_ROLES,
  requireRealmRole,
} from '@/lib/membership-guard'
import { requireGithubAppConfig } from '@/lib/github'
import { upsertGithubIntegration } from '@/lib/integrations'
import { createLogger } from '@/lib/logger'

const logger = createLogger('github-callback')

export const dynamic = 'force-dynamic'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url)
  const installationId = url.searchParams.get('installation_id')
  const state = url.searchParams.get('state')
  const setupAction = url.searchParams.get('setup_action')

  if (!installationId) {
    return Response.json(
      { error: 'Missing installation_id from GitHub callback' },
      { status: 400 },
    )
  }
  // state 即 realmId（install 路由注入）
  const realmId = state
  if (!realmId || !UUID_REGEX.test(realmId)) {
    return Response.json(
      { error: 'Invalid or missing state (realmId)' },
      { status: 400 },
    )
  }

  const actor = await resolveCurrentActor()
  if (actor === null) {
    return Response.json(
      { error: 'GitHub callback requires an authenticated session' },
      { status: 401 },
    )
  }

  try {
    requireGithubAppConfig()
    await requireEntitlement(realmId, { resource: 'realm', action: 'update' })
    await requireRealmRole(realmId, actor, MANAGE_MEMBER_ROLES)
  } catch {
    return Response.json(
      { error: 'Insufficient permissions to manage Realm integrations' },
      { status: 403 },
    )
  }

  try {
    await upsertGithubIntegration({
      realmId,
      installationId,
      createdBy: actor.actorId,
    })
  } catch (error) {
    logger.error('Failed to persist GitHub integration', {
      error,
      realmId,
      installationId,
    })
    return Response.json(
      { error: 'Failed to save GitHub integration' },
      { status: 500 },
    )
  }

  // 重定向到 Realm 集成设置页（Step 5 实现 UI）；带状态标记供前端识别
  const status = setupAction === 'uninstall' ? 'disconnected' : 'connected'
  const redirectUrl = `/realms/${realmId}/settings/integrations?github=${status}`
  return NextResponse.redirect(redirectUrl)
}
