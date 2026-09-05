// @aether/web · OAuth 授权决定（POST 语义，Server Action 承载）
// 批准 → 签发一次性 code → 302 redirect_uri?code&state；
// 拒绝 → 302 redirect_uri?error=access_denied&state。
// 全部参数与身份在 action 内重新校验（fail-closed，不信任表单隐藏域）：
// 校验失败回 /oauth/authorize 重新走 GET 渲染（错误页 / 登录跳转），绝不
// 重定向到未验证的 redirect_uri（防 open redirect）。
'use server'

import { redirect } from 'next/navigation'

import { resolveCurrentActor } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { requireRealmRole } from '@/lib/membership-guard'
import { authorizeQuerySchema } from '@/lib/oauth/protocol'
import {
  buildAuthorizeRedirect,
  issueAuthorizationCode,
  validateAuthorizeRequest,
} from '@/lib/oauth/service'

/** 表单允许的授权身份：全部 Realm 角色（授权是成员级操作）。 */
const AUTHORIZABLE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const

function optionalField(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  return value
}

/** 带原始查询参数回授权入口，由 GET 页重新渲染（错误页或登录跳转）。 */
function backToAuthorize(raw: Record<string, string | undefined>): never {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== '') params.set(key, value)
  }
  const query = params.toString()
  redirect(query === '' ? '/oauth/authorize' : `/oauth/authorize?${query}`)
}

export async function submitAuthorizeDecision(
  formData: FormData,
): Promise<void> {
  const raw = {
    client_id: optionalField(formData.get('client_id')),
    redirect_uri: optionalField(formData.get('redirect_uri')),
    response_type: optionalField(formData.get('response_type')),
    scope: optionalField(formData.get('scope')),
    state: optionalField(formData.get('state')),
    realm_id: optionalField(formData.get('realm_id')),
    code_challenge: optionalField(formData.get('code_challenge')),
    code_challenge_method: optionalField(
      formData.get('code_challenge_method'),
    ) as 'S256' | undefined,
  }
  const decisionEntry = formData.get('decision')
  const decision = typeof decisionEntry === 'string' ? decisionEntry : ''

  const parsed = authorizeQuerySchema.safeParse(raw)
  if (!parsed.success) backToAuthorize(raw)

  const db = getDb()
  const validation = await validateAuthorizeRequest(db, parsed.data)
  if (!validation.ok) backToAuthorize(raw)

  const actor = await resolveCurrentActor()
  if (actor === null) backToAuthorize(raw)
  try {
    await requireRealmRole(parsed.data.realm_id, actor, AUTHORIZABLE_ROLES)
  } catch {
    backToAuthorize(raw)
  }

  if (decision !== 'approve') {
    redirect(
      buildAuthorizeRedirect(parsed.data.redirect_uri, {
        error: 'access_denied',
        state: parsed.data.state,
      }),
    )
  }

  const { code } = await issueAuthorizationCode(db, {
    context: validation.context,
    userId: actor.actorId,
  })
  redirect(
    buildAuthorizeRedirect(parsed.data.redirect_uri, {
      code,
      state: parsed.data.state,
    }),
  )
}
