// @aether/web · Command Palette（Yohaku 复杂组件 3/4）
// 规则（Phase Shift Step 2 契约）：
//   ⌘K / Ctrl+K 全局唤起；输入区 bg-neutral-1 ring-1 ring-border focus:ring-accent
//   动作用 font-sans，路由提示用 font-mono；选中项 bg-neutral-2
// 行为：↑↓ 选择 / Enter 执行 / Esc 关闭；空输入列出全部命令。
'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { createThread } from '@/lib/threads'

interface CommandItem {
  /** 动作名（font-sans，参与过滤匹配） */
  label: string
  /** 分组标题 */
  group: string
  /** 右侧 mono 提示（路由或快捷键） */
  hint?: string
  href: string
}

interface CommandPaletteProps {
  /** 当前 Realm 上下文：提供则追加 Realm 内导航命令 */
  currentRealmId?: string | null
  currentRealmName?: string | null
  /** 编辑器选区：非空时 Cmd+K 进入"向 Entity 提问"模式（context-bound Thread 创建） */
  selection?: { text: string; start: number; end: number } | null
  /** 创建 Thread 所需的默认 project（提问模式用） */
  defaultProjectId?: string | null
  /** Thread 创建后回调（打开对话面板） */
  onThreadCreated?: (threadId: string, title: string) => void
}

export default function CommandPalette({
  currentRealmId = null,
  currentRealmName = null,
  selection = null,
  defaultProjectId = null,
  onThreadCreated,
}: CommandPaletteProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  /** 提问模式：选区非空且配置了 Realm + project 时启用 */
  const askMode = selection !== null && selection.text.length > 0 && currentRealmId !== null && defaultProjectId !== null

  const commands = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      { label: '首页', group: '导航', hint: '/', href: '/' },
      { label: 'Dashboard', group: '导航', hint: '/dashboard', href: '/dashboard' },
      { label: '所有 Realm', group: '导航', hint: '/realms', href: '/realms' },
    ]
    if (currentRealmId) {
      const group = currentRealmName ?? '当前 Realm'
      base.push(
        { label: '打开 Current', group, hint: '/realm/…/current', href: `/realm/${currentRealmId}/current` },
        { label: '审计记录', group, hint: '/realms/…/audit', href: `/realms/${currentRealmId}/audit` },
        { label: '成员管理', group, hint: '/realms/…/members', href: `/realms/${currentRealmId}/members` },
        { label: 'Realm 设置', group, hint: '/realms/…/settings', href: `/realms/${currentRealmId}/settings` },
      )
    }
    base.push({ label: '账户设置', group: '设置', hint: '/settings/profile', href: '/settings/profile' })
    return base
  }, [currentRealmId, currentRealmName])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return commands
    return commands.filter((command) =>
      command.label.toLowerCase().includes(keyword),
    )
  }, [commands, query])

  // 全局快捷键：⌘K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 打开时重置输入并聚焦
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      // 等待 portal 挂载后聚焦
      requestAnimationFrame(() => inputRef.current?.focus())
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = previousOverflow
      }
    }
  }, [open])

  // 过滤结果变化时收敛选中索引
  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered])

  // 选中项滚入可视区
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  const close = () => setOpen(false)

  // ---- 提问模式（context-bound Thread 创建）----
  if (askMode) {
    const handleAskSubmit = async () => {
      if (!query.trim() || !currentRealmId || !defaultProjectId || !selection) return
      setSubmitting(true)
      setAskError(null)
      try {
        const result = await createThread({
          realmId: currentRealmId,
          projectId: defaultProjectId,
          title: query.trim().slice(0, 80),
          codeAnchor: selection.text,
        })
        if (!result.success) {
          setAskError(result.error)
          return
        }
        onThreadCreated?.(result.data.id, result.data.title)
        close()
      } catch (err) {
        setAskError(err instanceof Error ? err.message : String(err))
      } finally {
        setSubmitting(false)
      }
    }

    const handleAskKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void handleAskSubmit()
      }
    }

    const preview = selection.text.slice(0, 120)

    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
        style={{ animation: 'yohaku-modal-backdrop-in 0.16s ease-out both' }}
        onKeyDown={handleAskKeyDown}
      >
        <div
          className="absolute inset-0 bg-neutral-10/50 backdrop-blur-sm"
          aria-hidden="true"
          onClick={close}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="向 Entity 提问"
          className="relative w-full max-w-md overflow-hidden rounded-xl bg-neutral-1 shadow-whisper ring-1 ring-border"
          style={{ animation: 'yohaku-modal-in 0.2s ease-out both' }}
        >
          <div className="border-b border-border p-3">
            <p className="px-1 pb-2 font-serif text-copy-14 font-medium text-neutral-9">
              向 Entity 提问
            </p>
            <div className="rounded-lg bg-neutral-1 px-3 py-2 ring-1 ring-border transition focus-within:ring-accent">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="针对选中的代码提问…"
                aria-label="提问内容"
                disabled={submitting}
                className="w-full bg-transparent text-copy-15 text-neutral-10 outline-none placeholder:text-neutral-4"
              />
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="mb-1 text-caption-10 uppercase tracking-[1.5px] text-neutral-5">
              已锚定代码选区 · {selection.text.length} 字符
            </p>
            <pre className="max-h-32 overflow-y-auto rounded-md bg-accent/10 px-3 py-2 font-mono text-label-12 text-accent whitespace-pre-wrap">
              {preview}
              {selection.text.length > 120 ? '…' : ''}
            </pre>
            {askError && (
              <p className="mt-2 text-label-12 text-error">{askError}</p>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <span className="text-label-12 text-neutral-5">
              <Kbd>Enter</Kbd> 发起 Thread · <Kbd>Esc</Kbd> 关闭
            </span>
            <button
              type="button"
              onClick={() => void handleAskSubmit()}
              disabled={submitting || !query.trim()}
              className="btn-primary text-label-12"
            >
              {submitting ? '创建中…' : '发起 Thread'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  // ---- 导航模式（现有行为）----
  const execute = (command: CommandItem) => {
    close()
    router.push(command.href)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const command = filtered[selectedIndex]
      if (command) execute(command)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ animation: 'yohaku-modal-backdrop-in 0.16s ease-out both' }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-neutral-10/50 backdrop-blur-sm"
        aria-hidden="true"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="relative w-full max-w-md overflow-hidden rounded-xl bg-neutral-1 shadow-whisper ring-1 ring-border"
        style={{ animation: 'yohaku-modal-in 0.2s ease-out both' }}
      >
        <div className="border-b border-border p-3">
          <div className="rounded-lg bg-neutral-1 px-3 py-2 ring-1 ring-border transition focus-within:ring-accent">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入命令或页面名…"
              aria-label="搜索命令"
              className="w-full bg-transparent text-copy-15 text-neutral-10 outline-none placeholder:text-neutral-4"
            />
          </div>
        </div>
        <ul
          ref={listRef}
          role="listbox"
          aria-label="命令列表"
          className="max-h-72 overflow-y-auto py-2"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-center text-copy-13 text-neutral-6">
              无匹配命令
            </li>
          ) : (
            filtered.map((command, index) => (
              <li
                key={`${command.group}:${command.label}`}
                role="option"
                aria-selected={index === selectedIndex}
              >
                <CommandRow
                  command={command}
                  selected={index === selectedIndex}
                  onHover={() => setSelectedIndex(index)}
                  onSelect={() => execute(command)}
                  showGroup={index === 0 || filtered[index - 1]?.group !== command.group}
                />
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-label-12 text-neutral-5">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> 选择</span>
          <span><Kbd>Enter</Kbd> 执行</span>
          <span><Kbd>Esc</Kbd> 关闭</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CommandRow({
  command,
  selected,
  onHover,
  onSelect,
  showGroup,
}: {
  command: CommandItem
  selected: boolean
  onHover: () => void
  onSelect: () => void
  showGroup: boolean
}) {
  return (
    <>
      {showGroup && (
        <p className="px-4 pb-1 pt-2 text-caption-10 uppercase tracking-[1.5px] text-neutral-5">
          {command.group}
        </p>
      )}
      <button
        type="button"
        onMouseEnter={onHover}
        onClick={onSelect}
        className={`flex w-full items-center justify-between px-4 py-2 text-left transition-colors ${
          selected
            ? 'bg-neutral-2 text-neutral-10'
            : 'text-neutral-8 hover:bg-neutral-2'
        }`}
      >
        <span className="text-copy-14">{command.label}</span>
        {command.hint && (
          <span className="ml-4 font-mono text-label-12 text-neutral-5">
            {command.hint}
          </span>
        )}
      </button>
    </>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-neutral-2 px-1.5 py-0.5 font-mono text-label-12 text-neutral-7 ring-1 ring-border">
      {children}
    </kbd>
  )
}
