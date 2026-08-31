// @aether/web · Settings 子导航（General / Members / Integrations）
// Yohaku：激活 bg-neutral-2 text-neutral-10 font-medium；非激活 text-neutral-7 hover:bg-neutral-2。
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SettingsTabNavProps {
  realmId: string
}

interface TabItem {
  href: string
  label: string
  active: boolean
}

export default function SettingsTabNav({ realmId }: SettingsTabNavProps) {
  const pathname = usePathname()
  const base = `/realms/${realmId}/settings`
  const items: TabItem[] = [
    {
      href: base,
      label: '通用',
      active: pathname === base,
    },
    {
      href: `${base}/members`,
      label: '成员',
      active: pathname.startsWith(`${base}/members`),
    },
    {
      href: `${base}/integrations`,
      label: '集成',
      active: pathname.startsWith(`${base}/integrations`),
    },
  ]

  return (
    <nav
      aria-label="Realm 设置"
      className="w-40 shrink-0"
    >
      <p className="px-3 pb-2 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        设置
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`block rounded-md px-3 py-2 text-copy-13 transition ${
                item.active
                  ? 'bg-neutral-2 font-medium text-neutral-10'
                  : 'text-neutral-7 hover:bg-neutral-2 hover:text-neutral-9'
              }`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
