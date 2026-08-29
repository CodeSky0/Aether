// @aether/web · Entity 头像与 Handoff 指示（Entity Observability 原语）
// 规则（Phase Shift Step 3 契约）：
//   头像：圆形，bg-neutral-3 text-neutral-8，取显示名首字母
//   状态点：active=梅（accent ume）/ idle=neutral-5 / error=蘇芳 suoh
//   working：头像外圈缓慢脉冲（梅红，ring 动画）；配 HandoffIndicator 斜体文案
// 状态与 working 均由真实数据驱动（members.status / entities.status / 近期审计活动），
// 本原语只负责呈现，不持有任何假状态。

import type { ReactNode } from 'react'

export type EntityStatus = 'active' | 'idle' | 'error'

/** 从显示状态推导状态点颜色 */
function statusDotClass(status: EntityStatus): string {
  if (status === 'active') return 'bg-accent'
  if (status === 'error') return 'bg-error'
  return 'bg-neutral-5'
}

/** members/entities 表的 status 字符串 → 展示状态 */
export function toEntityStatus(raw: string): EntityStatus {
  if (raw === 'active') return 'active'
  if (raw === 'suspended' || raw === 'error') return 'error'
  return 'idle'
}

interface EntityAvatarProps {
  /** 显示名（取首字母，CJK 取第一个字符） */
  name: string
  status: EntityStatus
  /** Entity 正在工作（收敛中）：外圈脉冲环 */
  working?: boolean
  size?: 'sm' | 'md'
}

export function EntityAvatar({
  name,
  status,
  working = false,
  size = 'sm',
}: EntityAvatarProps) {
  const dimension = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
  const fontSize = size === 'sm' ? 'text-label-12' : 'text-copy-13'
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`relative inline-flex items-center justify-center rounded-full bg-neutral-3 font-medium text-neutral-8 ${dimension} ${fontSize}`}
        aria-hidden="true"
      >
        {initial}
      </span>
      {working && (
        <span
          className={`absolute inset-0 animate-pulse rounded-full ring-2 ring-accent/40 ${dimension}`}
          aria-hidden="true"
        />
      )}
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-neutral-1 ${statusDotClass(status)}`}
        role="img"
        aria-label={
          status === 'active' ? '在线' : status === 'error' ? '异常' : '空闲'
        }
      />
    </span>
  )
}

/** Handoff 指示：Entity 正在工作时的斜体收敛文案（"Atlas 正在收敛…"） */
export function HandoffIndicator({ name }: { name: string }): ReactNode {
  return (
    <p className="truncate text-label-12 italic text-neutral-6">
      {name} 正在收敛…
    </p>
  )
}
