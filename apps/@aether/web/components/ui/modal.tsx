// @aether/web · Modal 原语（Yohaku 复杂组件 1/4）
// 规则（Phase Shift Step 2 契约）：
//   backdrop: bg-neutral-10/50 backdrop-blur-sm
//   container: bg-neutral-1 ring-1 ring-border rounded-xl shadow-whisper
//   动效：fade + scale-up ≤200ms（prefers-reduced-motion 全局降级）
// 行为：ESC 关闭 / 点击 backdrop 关闭 / 焦点困在容器内 / 打开时锁定滚动。
'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** 对话框可访问名称；不传则须在 children 内自带标题语义 */
  title: string
  children: ReactNode
  /** 底部操作区（按钮行等）；语义上属于对话框 */
  footer?: ReactNode
  className?: string
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className = '',
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // ESC 关闭 + 简易焦点陷阱（Tab 在容器内循环）
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // 打开时：锁定 body 滚动 + 初始焦点落进容器
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    containerRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ animation: 'yohaku-modal-backdrop-in 0.16s ease-out both' }}
    >
      {/* backdrop：仅点击自身时关闭（避免点击内容区误关） */}
      <div
        className="absolute inset-0 bg-neutral-10/50 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full max-w-md rounded-xl bg-neutral-1 shadow-whisper ring-1 ring-border outline-none ${className}`}
        style={{ animation: 'yohaku-modal-in 0.2s ease-out both' }}
      >
        <h2 className="px-6 pt-5 font-serif text-title-20 text-neutral-10">
          {title}
        </h2>
        <div className="px-6 pb-6 pt-3">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
