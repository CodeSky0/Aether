// @aether/web · Header 用户态
// 挂载时经 Better-Auth REST 查询会话；失败或未登录一律按未登录渲染，不抛错。
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface SessionUser {
  email: string | null
  name: string
}

export default function UserMenu() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadSession() {
      try {
        const response = await fetch('/api/auth/get-session')
        if (!response.ok) return
        const payload = (await response.json()) as { user?: SessionUser }
        if (!cancelled && payload.user) {
          setUser(payload.user)
        }
      } catch {
        // auth 未配置或网络失败：按未登录处理
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void loadSession()
    return () => {
      cancelled = true
    }
  }, [])

  async function signOut() {
    setSigningOut(true)
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' })
    } catch {
      // 会话 cookie 清理失败时也回到未登录态
    }
    setUser(null)
    setSigningOut(false)
    router.push('/')
    router.refresh()
  }

  if (!loaded && user === null) {
    // 首次会话查询完成前不渲染，避免闪烁错误状态
    return null
  }

  if (user === null) {
    return (
      <Link
        href="/login"
        className="text-copy-13 text-neutral-6 transition hover:text-neutral-9"
      >
        登录
      </Link>
    )
  }

  const display = user.email ?? user.name
  return (
    <div className="flex items-center gap-3">
      <span className="max-w-44 truncate text-copy-13 text-neutral-7" title={display}>
        {display}
      </span>
      <button
        type="button"
        className="text-copy-13 text-neutral-6 transition hover:text-neutral-9 disabled:opacity-50"
        disabled={signingOut}
        onClick={() => {
          void signOut()
        }}
      >
        {signingOut ? '登出中…' : '登出'}
      </button>
    </div>
  )
}
