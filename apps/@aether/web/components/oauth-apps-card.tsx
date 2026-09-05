// @aether/web · OAuth Apps 管理卡片（Realm Settings → Integrations）
// 三个区块：注册表单（owner/admin）/ App 列表（轮换 · 删除）/
// 我的授权（吊销）。明文 client_secret 仅注册/轮换后一次性展示。
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  deleteOAuthApp,
  registerOAuthApp,
  revokeOAuthAuthorization,
  rotateOAuthAppSecret,
} from '@/lib/oauth/actions'
import type {
  MyOAuthAuthorizationRow,
  OAuthAppRow,
  RegisteredOAuthApp,
} from '@/lib/oauth/actions'
import { useToast } from '@/components/ui/toast'

interface OAuthAppsCardProps {
  realmId: string
  apps: OAuthAppRow[]
  authorizations: MyOAuthAuthorizationRow[]
  canManage: boolean
}

const inputClass =
  'w-full rounded-md bg-neutral-1 px-3 py-2 text-copy-14 text-neutral-10 ring-1 ring-border outline-none transition placeholder:text-neutral-4 focus:ring-2 focus:ring-accent/50'
const labelClass = 'font-mono text-label-12 uppercase tracking-wider text-neutral-6'

function formatDate(value: Date | null): string {
  if (value === null) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

/** 明文 secret 一次性展示（注册 / 轮换共用）。 */
function SecretReveal({
  label,
  secret,
  onDone,
}: {
  label: string
  secret: string
  onDone: () => void
}) {
  const toast = useToast()
  return (
    <div className="mt-4 rounded-lg border border-success/40 bg-success/10 p-4">
      <p className="text-label-12 text-success">
        {label}（仅此一次显示，关闭后无法找回）
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-neutral-1 px-3 py-2 font-mono text-label-12 text-neutral-9">
          {secret}
        </code>
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => {
            void navigator.clipboard
              .writeText(secret)
              .then(() => toast.success('已复制到剪贴板'))
              .catch(() => toast.error('复制失败，请手动选择复制'))
          }}
        >
          复制
        </button>
        <button type="button" className="btn-ghost shrink-0" onClick={onDone}>
          关闭
        </button>
      </div>
    </div>
  )
}

export default function OAuthAppsCard({
  realmId,
  apps,
  authorizations,
  canManage,
}: OAuthAppsCardProps) {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = useState('')
  const [redirectUrisText, setRedirectUrisText] = useState('')
  const [registering, setRegistering] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<{ label: string; secret: string } | null>(null)
  const [pendingAppId, setPendingAppId] = useState<string | null>(null)
  const [pendingAuthorizationId, setPendingAuthorizationId] = useState<string | null>(null)

  async function handleRegister() {
    const redirectUris = redirectUrisText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    setRegistering(true)
    try {
      const result = await registerOAuthApp({ realmId, name: name.trim(), redirectUris })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const registered: RegisteredOAuthApp = result.data
      toast.success(`应用「${registered.name}」已注册`)
      setRevealedSecret({ label: 'client_secret', secret: registered.client_secret })
      setName('')
      setRedirectUrisText('')
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '注册失败，请稍后重试。')
    } finally {
      setRegistering(false)
    }
  }

  async function handleRotate(app: OAuthAppRow) {
    setPendingAppId(app.id)
    try {
      const result = await rotateOAuthAppSecret({ realmId, appId: app.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`「${app.name}」的 client_secret 已轮换，旧 secret 立即失效`)
      setRevealedSecret({ label: `「${app.name}」新 client_secret`, secret: result.data.client_secret })
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '轮换失败，请稍后重试。')
    } finally {
      setPendingAppId(null)
    }
  }

  async function handleDelete(app: OAuthAppRow) {
    if (!window.confirm(`确定删除应用「${app.name}」？其全部授权与令牌将立即失效。`)) return
    setPendingAppId(app.id)
    try {
      const result = await deleteOAuthApp({ realmId, appId: app.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`应用「${app.name}」已删除，其授权令牌已全部失效`)
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '删除失败，请稍后重试。')
    } finally {
      setPendingAppId(null)
    }
  }

  async function handleRevoke(authorization: MyOAuthAuthorizationRow) {
    setPendingAuthorizationId(authorization.id)
    try {
      const result = await revokeOAuthAuthorization({
        realmId,
        authorizationId: authorization.id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`已吊销「${authorization.app_name}」的授权`)
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '吊销失败，请稍后重试。')
    } finally {
      setPendingAuthorizationId(null)
    }
  }

  return (
    <section className="rounded-xl bg-neutral-1 p-6 ring-1 ring-border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-title-20 text-neutral-10">OAuth Apps</h3>
          <p className="mt-0.5 text-copy-14 text-neutral-7">
            第三方应用经 OAuth 2.0（PKCE）访问 Resonance API
          </p>
        </div>
        <span className="text-label-12 text-neutral-5">授权码模式 · S256</span>
      </div>

      {canManage && (
        <form
          className="mt-5 space-y-3 rounded-lg bg-neutral-2 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            void handleRegister()
          }}
        >
          <div>
            <label htmlFor="oauth-app-name" className={labelClass}>
              应用名称
            </label>
            <input
              id="oauth-app-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${inputClass} mt-1.5`}
              placeholder="例如：Aether CLI"
              maxLength={100}
              required
            />
          </div>
          <div>
            <label htmlFor="oauth-app-redirects" className={labelClass}>
              回调 URI（每行一个，https，localhost 例外）
            </label>
            <textarea
              id="oauth-app-redirects"
              value={redirectUrisText}
              onChange={(e) => setRedirectUrisText(e.target.value)}
              className={`${inputClass} mt-1.5 font-mono text-label-12`}
              placeholder={'https://example.com/callback\nhttp://localhost:3000/callback'}
              rows={3}
              required
            />
          </div>
          <button type="submit" disabled={registering} className="btn-primary">
            {registering ? '注册中…' : '注册应用'}
          </button>
        </form>
      )}

      {revealedSecret && (
        <SecretReveal
          label={revealedSecret.label}
          secret={revealedSecret.secret}
          onDone={() => setRevealedSecret(null)}
        />
      )}

      {apps.length > 0 ? (
        <ul className="mt-5 divide-y divide-border">
          {apps.map((app) => (
            <li key={app.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-serif text-copy-16 text-neutral-9">{app.name}</p>
                  <p className="mt-1 break-all font-mono text-label-12 text-neutral-6">
                    {app.client_id} · secret {app.client_secret_prefix}…
                  </p>
                  <p className="mt-1 break-all font-mono text-caption-10 text-neutral-5">
                    {app.redirect_uris.join(' · ')}
                  </p>
                  <p className="mt-1 text-caption-10 text-neutral-5">
                    创建于 {formatDate(app.created_at)}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={pendingAppId === app.id}
                      onClick={() => { void handleRotate(app) }}
                      className="btn-ghost"
                    >
                      轮换 secret
                    </button>
                    <button
                      type="button"
                      disabled={pendingAppId === app.id}
                      onClick={() => { void handleDelete(app) }}
                      className="btn-ghost text-error hover:text-error"
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-label-12 text-neutral-5">
          {canManage ? '尚未注册应用。' : '管理员尚未注册任何应用。'}
        </p>
      )}

      <div className="mt-8 border-t border-border pt-5">
        <h4 className="font-serif text-title-20 text-neutral-8">我的授权</h4>
        <p className="mt-0.5 text-copy-14 text-neutral-6">
          你通过同意页授予应用的令牌；吊销后立即失效。
        </p>
        {authorizations.length > 0 ? (
          <ul className="mt-4 divide-y divide-border">
            {authorizations.map((authorization) => (
              <li key={authorization.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-copy-14 text-neutral-9">
                    {authorization.app_name}
                    {authorization.token_prefix !== null && (
                      <span className="ml-2 font-mono text-label-12 text-neutral-5">
                        token {authorization.token_prefix}…
                      </span>
                    )}
                  </p>
                  <p className="mt-1 font-mono text-label-12 text-neutral-6">
                    {authorization.scopes.join(' ')}
                  </p>
                  <p className="mt-1 text-caption-10 text-neutral-5">
                    签发 {formatDate(authorization.token_issued_at)} · 最近使用{' '}
                    {formatDate(authorization.last_used_at)}
                  </p>
                </div>
                {authorization.token_prefix !== null && (
                  <button
                    type="button"
                    disabled={pendingAuthorizationId === authorization.id}
                    onClick={() => { void handleRevoke(authorization) }}
                    className="btn-ghost shrink-0 text-error hover:text-error"
                  >
                    吊销
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-label-12 text-neutral-5">暂无授权记录。</p>
        )}
      </div>
    </section>
  )
}
