// @aether/web · GET /oauth/authorize — OAuth 授权同意页
// 校验链（fail-closed，任一失败渲染错误页，绝不重定向——防 open redirect）：
//   参数 schema → app/realm/redirect_uri/scope（validateAuthorizeRequest）→
//   会话（未登录跳登录页带回跳）→ Realm active membership。
// 通过 → 同意页：App 名、client_id、scopes 可读解释、授权身份、批准/拒绝。
// 决定提交走 actions.ts（Server Action，重新全量校验）。
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { tryGetAuth } from '@/lib/auth'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { requireRealmRole } from '@/lib/membership-guard'
import { authorizeQuerySchema } from '@/lib/oauth/protocol'
import { validateAuthorizeRequest } from '@/lib/oauth/service'
import { submitAuthorizeDecision } from './actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/** scope → 同意页可读解释（与 spec 的 scope 目录一致）。 */
const SCOPE_EXPLANATIONS: Record<string, string> = {
  read: '读取该 Realm 的全部 /api/v1 数据（GET / HEAD）',
  write: '创建与修改数据，含 Thread、Dialogue 与 Webhook 订阅管理（POST / PATCH / DELETE）',
}

export default async function OAuthAuthorizePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const raw = {
    client_id: first(sp.client_id),
    redirect_uri: first(sp.redirect_uri),
    response_type: first(sp.response_type),
    scope: first(sp.scope),
    state: first(sp.state),
    realm_id: first(sp.realm_id),
    code_challenge: first(sp.code_challenge),
    code_challenge_method: first(sp.code_challenge_method) as 'S256' | undefined,
  }

  const parsed = authorizeQuerySchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return (
      <AuthorizeErrorPage
        title="授权请求无效"
        detail={issue ? `${issue.path.join('.')}: ${issue.message}` : '参数缺失或不合法。'}
      />
    )
  }
  const query = parsed.data

  const validation = await validateAuthorizeRequest(getDb(), query)
  if (!validation.ok) {
    return <AuthorizeErrorPage title="授权请求无效" detail={validation.error} />
  }

  const actor = await resolveCurrentActor()
  if (actor === null) {
    const next = `/oauth/authorize?${new URLSearchParams(
      Object.entries(raw).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ).toString()}`
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  try {
    await requireRealmRole(query.realm_id, actor, ['owner', 'admin', 'member', 'viewer'])
  } catch {
    return (
      <AuthorizeErrorPage
        title="无法授权"
        detail="你不是该 Realm 的有效成员，无法向应用授予访问权限。"
      />
    )
  }

  const auth = tryGetAuth()
  let userLabel = '当前用户'
  if (auth !== null) {
    try {
      const session = await auth.api.getSession({ headers: await headers() })
      if (session?.user) {
        userLabel =
          session.user.name !== '' ? session.user.name : session.user.email
      }
    } catch {
      // 展示回退到默认文案；授权判定不依赖此查询
    }
  }

  const { context } = validation
  const hiddenFields: Array<[string, string | undefined]> = [
    ['client_id', query.client_id],
    ['redirect_uri', query.redirect_uri],
    ['response_type', 'code'],
    ['realm_id', query.realm_id],
    ['scope', context.scopes.join(' ')],
    ['code_challenge', query.code_challenge],
    ['code_challenge_method', query.code_challenge_method],
    ['state', query.state],
  ]

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-1 px-6 py-16">
      <header className="enter text-center">
        <h1 className="font-serif text-display-36 font-medium tracking-tight text-neutral-10">
          Aether<span className="text-accent">.</span>
        </h1>
        <p className="mt-2 font-mono text-label-12 uppercase tracking-widest text-neutral-6">
          authorization request
        </p>
      </header>

      <main className="enter mt-10 w-full max-w-md" style={{ animationDelay: '80ms' }}>
        <div className="rounded-xl bg-neutral-1 p-8 ring-1 ring-border">
          <p className="font-serif text-title-20 text-neutral-10">
            <span className="text-neutral-9">{context.app.name}</span> 请求访问
          </p>
          <p className="mt-1 text-copy-14 text-neutral-6">
            Realm <span className="text-neutral-8">{context.realm.name}</span>
            （{context.realm.slug}）
          </p>

          <dl className="mt-6 space-y-3">
            <div>
              <dt className="font-mono text-label-12 uppercase tracking-wider text-neutral-5">
                client_id
              </dt>
              <dd className="mt-1 break-all font-mono text-label-12 text-neutral-8">
                {context.app.clientId}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-label-12 uppercase tracking-wider text-neutral-5">
                授权身份
              </dt>
              <dd className="mt-1 text-copy-14 text-neutral-8">{userLabel}</dd>
            </div>
            <div>
              <dt className="font-mono text-label-12 uppercase tracking-wider text-neutral-5">
                权限范围
              </dt>
              <dd className="mt-1">
                <ul className="space-y-1.5">
                  {context.scopes.map((scope) => (
                    <li key={scope} className="text-copy-14 text-neutral-8">
                      <span className="font-mono text-label-12 text-neutral-9">{scope}</span>
                      <span className="mx-1.5 text-neutral-4">·</span>
                      {SCOPE_EXPLANATIONS[scope] ?? scope}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>

          <form action={submitAuthorizeDecision} className="mt-8 flex gap-3">
            {hiddenFields
              .filter(([, value]) => value !== undefined)
              .map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
            <button
              type="submit"
              name="decision"
              value="approve"
              className="btn-primary flex-1 px-6 py-2.5"
            >
              批准
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              className="btn-ghost flex-1 px-6 py-2.5"
            >
              拒绝
            </button>
          </form>

          <p className="mt-4 text-caption-10 text-neutral-5">
            批准后应用将获得以上权限的长期访问令牌；可随时在 Realm 设置中吊销。
          </p>
        </div>
      </main>

      <footer
        className="enter mt-10 font-mono text-caption-10 text-neutral-6"
        style={{ animationDelay: '160ms' }}
      >
        Yohaku V0.1 · Aether OAuth
      </footer>
    </div>
  )
}

function AuthorizeErrorPage({
  title,
  detail,
}: {
  title: string
  detail: string
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-1 px-6 py-16">
      <header className="enter text-center">
        <h1 className="font-serif text-display-36 font-medium tracking-tight text-neutral-10">
          Aether<span className="text-accent">.</span>
        </h1>
        <p className="mt-2 font-mono text-label-12 uppercase tracking-widest text-neutral-6">
          authorization request
        </p>
      </header>

      <main className="enter mt-10 w-full max-w-md" style={{ animationDelay: '80ms' }}>
        <div className="rounded-xl bg-neutral-1 p-8 ring-1 ring-border">
          <p className="font-serif text-title-20 text-error">{title}</p>
          <p className="mt-2 break-words text-copy-14 text-neutral-6">{detail}</p>
          <p className="mt-4 text-caption-10 text-neutral-5">
            出于安全考虑，本页不会重定向回发起方。请联系应用开发者核对授权链接。
          </p>
        </div>
      </main>
    </div>
  )
}
