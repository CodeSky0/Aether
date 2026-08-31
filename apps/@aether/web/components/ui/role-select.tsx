// @aether/web · RoleSelect 自定义下拉（Yohaku，无 native select）
// 触发器 btn-ghost 样式；菜单 bg-neutral-1 ring-1 ring-border rounded-md shadow-whisper。
'use client'

import { useEffect, useRef, useState } from 'react'

export type RealmRole = 'owner' | 'admin' | 'member' | 'viewer'

const ROLE_LABELS: Record<RealmRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

interface RoleSelectProps {
  value: RealmRole
  onChange: (role: RealmRole) => void
  disabled?: boolean
  /** 排除某些角色（如不允许选 owner） */
  exclude?: readonly RealmRole[]
  className?: string
}

export default function RoleSelect({
  value,
  onChange,
  disabled,
  exclude,
  className = '',
}: RoleSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const options = (Object.keys(ROLE_LABELS) as RealmRole[]).filter(
    (role) => !exclude?.includes(role),
  )

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="btn-ghost min-w-24 justify-between"
      >
        {ROLE_LABELS[value]}
        <span className="text-neutral-5">▾</span>
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-1 w-32 rounded-md bg-neutral-1 py-1 shadow-whisper ring-1 ring-border">
          {options.map((role) => (
            <li key={role}>
              <button
                type="button"
                onClick={() => {
                  onChange(role)
                  setOpen(false)
                }}
                className={`block w-full px-3 py-1.5 text-left text-copy-13 transition hover:bg-neutral-2 ${
                  role === value ? 'text-neutral-10 font-medium' : 'text-neutral-7'
                }`}
              >
                {ROLE_LABELS[role]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
