// @aether/web · 用户级设置 tab 导航（资料 / AI 配置）
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function UserSettingsTabs() {
  const pathname = usePathname()
  const items = [
    { href: '/settings/profile', label: '资料' },
    { href: '/settings/ai', label: 'AI 配置' },
  ]
  return (
    <nav className="mt-6 flex gap-1">
      {items.map((item) => {
        const active = pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-copy-13 transition ${
              active
                ? 'bg-neutral-2 font-medium text-neutral-10'
                : 'text-neutral-7 hover:bg-neutral-2 hover:text-neutral-9'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
