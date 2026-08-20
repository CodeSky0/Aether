// @aether/web · 导航 Shell：Header + 左侧 Sidebar
// 在 /realms 和 /realms/[id] 下渲染；Landing 页（/）保持简洁不挂载。
// Yohaku：serif 字承担品牌层级，accent 只出现在品牌点与激活态。
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import UserMenu from '@/components/user-menu'
interface NavShellProps {
  children: ReactNode
  currentRealmName?: string | null
  currentRealmId?: string | null
}
export default function NavShell({ children, currentRealmName, currentRealmId }: NavShellProps) {
  const pathname = usePathname()
  const isInApp = pathname.startsWith('/realms')
  const [realmName, setRealmName] = useState<string | null>(currentRealmName ?? null)
  useEffect(() => {
    if (currentRealmName !== undefined) {
      setRealmName(currentRealmName)
    }
  }, [currentRealmName])
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-paper px-6 md:px-8">
        <Link
          href="/"
          className="font-logo-latin text-copy-16 font-medium tracking-tight text-neutral-10"
        >
          Aether<span className="text-accent">.</span>
        </Link>
        {isInApp && realmName && (
          <>
            <span className="mx-3 text-copy-13 text-neutral-4">/</span>
            <span className="max-w-56 truncate text-copy-13 text-neutral-7">{realmName}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-4">
          <Link
            href="/"
            className="text-copy-13 text-neutral-6 transition hover:text-neutral-9"
          >
            首页
          </Link>
          <UserMenu />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {isInApp && currentRealmId !== undefined && (
          <Sidebar currentRealmId={currentRealmId} />
        )}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
function Sidebar({ currentRealmId }: { currentRealmId?: string | null }) {
  const pathname = usePathname()
  // P1-8 修复：统一高亮判定规则。
  // "所有 Realm" 只在精确匹配 /realms 时高亮，避免 /realms/[id] 子路由下误高亮。
  const isRealmsActive = pathname === '/realms'
  const isCurrentActive = currentRealmId
    ? pathname.startsWith(`/realm/${currentRealmId}/current`)
    : false
  const isAuditActive = currentRealmId
    ? pathname === `/realms/${currentRealmId}/audit` || pathname.startsWith(`/realms/${currentRealmId}/audit/`)
    : false
  const isMembersActive = currentRealmId
    ? pathname === `/realms/${currentRealmId}/members` || pathname.startsWith(`/realms/${currentRealmId}/members/`)
    : false
  const linkClass = (active: boolean) =>
    `rounded-md px-3 py-2 text-copy-13 transition ${
      active
        ? 'bg-accent/10 font-medium text-accent'
        : 'text-neutral-7 hover:bg-neutral-2 hover:text-neutral-9'
    }`
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-neutral-1 p-4 md:block">
      <nav className="flex flex-col gap-1">
        <p className="px-3 pb-1 pt-2 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
          Realm
        </p>
        <Link href="/realms" className={linkClass(isRealmsActive)}>
          所有 Realm
        </Link>
        {currentRealmId && (
          <>
            <p className="mt-5 px-3 pb-1 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
              当前 Realm
            </p>
            <Link
              href={`/realm/${currentRealmId}/current`}
              className={linkClass(isCurrentActive)}
            >
              Current
            </Link>
            <Link
              href={`/realms/${currentRealmId}/audit`}
              className={linkClass(isAuditActive)}
            >
              审计记录
            </Link>
            <Link
              href={`/realms/${currentRealmId}/members`}
              className={linkClass(isMembersActive)}
            >
              成员管理
            </Link>
          </>
        )}
      </nav>
    </aside>
  )
}
