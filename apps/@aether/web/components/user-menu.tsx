// @aether/web · Header 用户态：头像 + Dropdown（Step 5 契约）
// 挂载时经 Better-Auth REST 查询会话；失败或未登录一律按未登录渲染，不抛错。
// Dropdown：账户设置 / 登出；外点与 ESC 关闭。
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { IconLogout, IconSettings } from '@/components/ui/icons'

interface SessionUser {
  email: string | null
  name: string
}

export default function UserMenu() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

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

  // Dropdown 开启时：外点 + ESC 关闭
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  async function signOut() {
    setSigningOut(true)
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' })
    } catch {
      // 会话 cookie 清理失败时也回到未登录态
    }
    setUser(null)
    setSigningOut(false)
    setOpen(false)
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
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="用户菜单"
        title={display}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-3 text-copy-13 font-medium text-neutral-8 transition hover:bg-neutral-4 hover:text-neutral-9"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          style={{ animation: 'yohaku-toast-in 0.15s ease-out both' }}
          className="absolute right-0 top-10 z-50 w-48 rounded-lg bg-neutral-1 py-1 shadow-whisper ring-1 ring-border"
        >
          <p className="truncate px-3 py-2 text-label-12 text-neutral-6">
            {display}
          </p>
          <div className="my-1 h-px bg-border" aria-hidden="true" />
          <Link
            href="/settings/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-copy-13 text-neutral-7 transition hover:bg-neutral-2 hover:text-neutral-9"
          >
            <IconSettings className="h-4 w-4 text-neutral-6" />
            账户设置
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => {
              void signOut()
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-copy-13 text-neutral-7 transition hover:bg-neutral-2 hover:text-neutral-9 disabled:opacity-50"
          >
            <IconLogout className="h-4 w-4 text-neutral-6" />
            {signingOut ? '登出中…' : '登出'}
          </button>
        </div>
      )}
    </div>
  )
}
