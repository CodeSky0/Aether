// @aether/web · 登录 / 注册表单与 OIDC 登录入口
// 全部走 Better-Auth 标准 REST 端点，不引入 better-auth/client。
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import type { WebOidcProvider } from '@/lib/auth'

interface AuthFormsProps {
  oidcProvider: WebOidcProvider | null
}

type Mode = 'sign-in' | 'sign-up'

async function postAuthJson(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) return

  let message = `请求失败（${response.status}）`
  try {
    const payload = (await response.json()) as { message?: string; code?: string }
    if (payload.message) {
      message = payload.code ? `${payload.message}（${payload.code}）` : payload.message
    }
  } catch {
    // 保留默认错误消息
  }
  throw new Error(message)
}

export default function AuthForms({ oidcProvider }: AuthFormsProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      if (mode === 'sign-in') {
        await postAuthJson('/api/auth/sign-in/email', { email, password })
      } else {
        await postAuthJson('/api/auth/sign-up/email', { email, password, name })
      }
      router.push('/')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '请求失败，请稍后再试')
      setPending(false)
    }
  }

  async function signInWithOidc() {
    if (!oidcProvider) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/sign-in/oauth2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: oidcProvider.providerId,
          callbackURL: '/',
        }),
      })
      const payload = (await response.json()) as {
        url?: string
        message?: string
        code?: string
      }
      if (!response.ok || !payload.url) {
        throw new Error(
          payload.message
            ? `${payload.message}${payload.code ? `（${payload.code}）` : ''}`
            : `无法发起 ${oidcProvider.name} 登录（${response.status}）`,
        )
      }
      window.location.assign(payload.url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法发起 SSO 登录')
      setPending(false)
    }
  }

  const inputClass =
    'w-full rounded-md border border-border bg-paper px-3 py-2 text-copy-14 text-neutral-10 outline-none transition focus:border-accent'

  return (
    <div className="w-full max-w-sm">
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        className="flex flex-col gap-4"
      >
        {mode === 'sign-up' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-label-12 text-neutral-7">显示名</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-label-12 text-neutral-7">邮箱</span>
          <input
            className={inputClass}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-label-12 text-neutral-7">密码</span>
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            minLength={8}
            required
          />
        </label>

        {error && (
          <p className="rounded-md bg-error/10 p-3 text-label-12 text-error">{error}</p>
        )}

        <button type="submit" className="btn-primary" disabled={pending}>
          {pending
            ? '处理中…'
            : mode === 'sign-in'
              ? '登录'
              : '创建账号'}
        </button>
      </form>

      <p className="mt-4 text-copy-13 text-neutral-6">
        {mode === 'sign-in' ? '还没有账号？' : '已有账号？'}
        <button
          type="button"
          className="ml-1 text-accent underline-offset-2 hover:underline"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
            setError(null)
          }}
        >
          {mode === 'sign-in' ? '注册' : '去登录'}
        </button>
      </p>

      {oidcProvider && (
        <>
          <div className="my-6 flex items-center gap-3 text-caption-10 uppercase tracking-[1.5px] text-neutral-5">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <button
            type="button"
            className="w-full rounded-md border border-border bg-paper px-3 py-2 text-copy-14 text-neutral-9 transition hover:border-accent hover:text-accent disabled:opacity-50"
            disabled={pending}
            onClick={() => {
              void signInWithOidc()
            }}
          >
            使用 {oidcProvider.name} 登录
          </button>
        </>
      )}
    </div>
  )
}
