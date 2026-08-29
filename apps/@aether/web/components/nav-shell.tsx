// @aether/web · 导航 Shell：Top Bar（面包屑 + 用户）+ 可折叠 Sidebar
// 在 /dashboard、/realms、/realm、/settings 下渲染；Landing 与登录页不挂载。
// Step 5 契约：
//   Sidebar 可折叠（localStorage 记忆）；激活项 bg-neutral-2 text-neutral-10 font-medium；
//   非激活 text-neutral-7 hover:text-neutral-9 hover:bg-neutral-2；图标 stroke 1.5 text-neutral-6。
//   面包屑 font-mono text-xs text-neutral-6（Realm / 区块）。
// Yohaku：serif 只承担品牌字，accent 只出现在品牌点；导航态全部走中性阶层。
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import UserMenu from '@/components/user-menu'
import CommandPalette from '@/components/ui/command-palette'
import {
  IconCurrent,
  IconDashboard,
  IconLayers,
  IconPanelCollapse,
  IconPanelExpand,
  IconScroll,
  IconSettings,
  IconUsers,
} from '@/components/ui/icons'

interface NavShellProps {
  children: ReactNode
  currentRealmName?: string | null
  currentRealmId?: string | null
}

/** 折叠态持久化 key */
const SIDEBAR_COLLAPSED_KEY = 'aether.sidebar-collapsed'

/** 应用内路由（挂载 Sidebar）；Landing / 登录页除外。 */
function isAppRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/realms') ||
    pathname.startsWith('/realm') ||
    pathname.startsWith('/settings')
  )
}

export default function NavShell({ children, currentRealmName, currentRealmId }: NavShellProps) {
  const pathname = usePathname()
  const [realmName, setRealmName] = useState<string | null>(currentRealmName ?? null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (currentRealmName !== undefined) {
      setRealmName(currentRealmName)
    }
  }, [currentRealmName])

  // 折叠态从 localStorage 恢复（SSR 安全：仅客户端）
  useEffect(() => {
    setCollapsed(
      window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
    )
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  return (
    <div className="flex h-screen flex-col">
      <CommandPalette currentRealmId={currentRealmId ?? null} currentRealmName={realmName} />
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-paper px-4 md:px-6">
        <Link
          href="/"
          className="font-logo-latin text-copy-16 font-medium tracking-tight text-neutral-10"
        >
          Aether<span className="text-accent">.</span>
        </Link>
        <Breadcrumbs pathname={pathname} realmName={realmName} currentRealmId={currentRealmId ?? null} />
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden items-center gap-2 font-mono text-label-12 text-neutral-5 md:flex">
            <kbd className="rounded bg-neutral-2 px-1.5 py-0.5 ring-1 ring-border">⌘K</kbd>
            命令
          </span>
          <UserMenu />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {isAppRoute(pathname) && (
          <Sidebar
            currentRealmId={currentRealmId ?? null}
            realmName={realmName}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapsed}
          />
        )}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

/** 面包屑：font-mono text-xs text-neutral-6；Realm 名 / 当前区块。 */
function Breadcrumbs({
  pathname,
  realmName,
  currentRealmId,
}: {
  pathname: string
  realmName: string | null
  currentRealmId: string | null
}) {
  const crumbs = buildCrumbs(pathname, realmName, currentRealmId)
  if (crumbs.length === 0) return null
  return (
    <nav
      aria-label="面包屑"
      className="ml-4 flex min-w-0 items-center gap-2 font-mono text-label-12 text-neutral-6"
    >
      {crumbs.map((crumb, index) => (
        <span key={crumb.key} className="flex min-w-0 items-center gap-2">
          {index > 0 && <span className="text-neutral-4">/</span>}
          <span className={`truncate ${index === crumbs.length - 1 ? 'text-neutral-7' : ''}`}>
            {crumb.label}
          </span>
        </span>
      ))}
    </nav>
  )
}

interface Crumb {
  key: string
  label: string
}

/** 从路径推导面包屑区块：Realm 名（有上下文时）+ 区块名。 */
function buildCrumbs(
  pathname: string,
  realmName: string | null,
  currentRealmId: string | null,
): Crumb[] {
  const crumbs: Crumb[] = []
  if (pathname === '/dashboard') {
    crumbs.push({ key: 'dashboard', label: 'dashboard' })
  } else if (pathname === '/realms') {
    crumbs.push({ key: 'realms', label: 'realms' })
  } else if (pathname.startsWith('/settings')) {
    crumbs.push({ key: 'settings', label: 'settings / profile' })
  } else if (currentRealmId) {
    if (realmName) crumbs.push({ key: 'realm', label: realmName })
    if (pathname.includes('/current')) {
      crumbs.push({ key: 'current', label: 'current' })
    } else if (pathname.includes('/audit')) {
      crumbs.push({ key: 'audit', label: 'audit' })
    } else if (pathname.includes('/members')) {
      crumbs.push({ key: 'members', label: 'members' })
    } else if (pathname.includes('/settings')) {
      crumbs.push({ key: 'settings', label: 'settings' })
    }
  }
  return crumbs
}

interface SidebarNavItem {
  href: string
  label: string
  icon: ReactNode
  active: boolean
}

function Sidebar({
  currentRealmId,
  realmName,
  collapsed,
  onToggleCollapse,
}: {
  currentRealmId: string | null
  realmName: string | null
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const pathname = usePathname()

  // P1-8 规则沿用：「所有 Realm」仅精确匹配 /realms 高亮。
  const navItems: SidebarNavItem[] = [
    {
      href: '/dashboard',
      label: 'Dashboard',
      icon: <IconDashboard className="h-4 w-4" />,
      active: pathname === '/dashboard',
    },
    {
      href: '/realms',
      label: '所有 Realm',
      icon: <IconLayers className="h-4 w-4" />,
      active: pathname === '/realms',
    },
  ]
  if (currentRealmId) {
    navItems.push(
      {
        href: `/realm/${currentRealmId}/current`,
        label: 'Current',
        icon: <IconCurrent className="h-4 w-4" />,
        active: pathname.startsWith(`/realm/${currentRealmId}/current`),
      },
      {
        href: `/realms/${currentRealmId}/audit`,
        label: '审计记录',
        icon: <IconScroll className="h-4 w-4" />,
        active: pathname.startsWith(`/realms/${currentRealmId}/audit`),
      },
      {
        href: `/realms/${currentRealmId}/members`,
        label: '成员管理',
        icon: <IconUsers className="h-4 w-4" />,
        active: pathname.startsWith(`/realms/${currentRealmId}/members`),
      },
      {
        href: `/realms/${currentRealmId}/settings`,
        label: 'Realm 设置',
        icon: <IconSettings className="h-4 w-4" />,
        active: pathname.startsWith(`/realms/${currentRealmId}/settings`),
      },
    )
  }

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r border-border bg-neutral-1 transition-[width] duration-200 md:flex ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      <div className={`flex items-center pb-1 pt-3 ${collapsed ? 'justify-center px-1' : 'justify-end px-3'}`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
          className="rounded-md p-1.5 text-neutral-6 transition hover:bg-neutral-2 hover:text-neutral-9"
        >
          {collapsed ? (
            <IconPanelExpand className="h-4 w-4" />
          ) : (
            <IconPanelCollapse className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4">
        <SidebarSectionLabel collapsed={collapsed}>导航</SidebarSectionLabel>
        {navItems.slice(0, 2).map((item) => (
          <SidebarLink key={item.href} item={item} collapsed={collapsed} />
        ))}

        {currentRealmId && (
          <>
            <SidebarSectionLabel collapsed={collapsed}>
              {realmName ?? '当前 Realm'}
            </SidebarSectionLabel>
            {navItems.slice(2).map((item) => (
              <SidebarLink key={item.href} item={item} collapsed={collapsed} />
            ))}
          </>
        )}
      </nav>
    </aside>
  )
}

function SidebarSectionLabel({
  collapsed,
  children,
}: {
  collapsed: boolean
  children: ReactNode
}) {
  if (collapsed) {
    return <div className="mx-auto my-2 h-px w-6 bg-border" aria-hidden="true" />
  }
  return (
    <p className="truncate px-3 pb-1 pt-2 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
      {children}
    </p>
  )
}

function SidebarLink({
  item,
  collapsed,
}: {
  item: SidebarNavItem
  collapsed: boolean
}) {
  // Step 5 契约：激活 bg-neutral-2 text-neutral-10 font-medium；
  // 非激活 text-neutral-7 hover:text-neutral-9 hover:bg-neutral-2。
  const className = collapsed
    ? `justify-center ${item.active
        ? 'bg-neutral-2 text-neutral-10'
        : 'text-neutral-7 hover:bg-neutral-2 hover:text-neutral-9'}`
    : `${item.active
        ? 'bg-neutral-2 font-medium text-neutral-10'
        : 'text-neutral-7 hover:bg-neutral-2 hover:text-neutral-9'}`
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-copy-13 transition ${className}`}
    >
      <span className={`shrink-0 ${item.active ? 'text-neutral-8' : 'text-neutral-6'}`}>
        {item.icon}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}
