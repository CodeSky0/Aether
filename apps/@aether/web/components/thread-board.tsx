// @aether/web · Thread 看板视图
// 四列（Open / In Review / Resolved / Archived）按状态分组，
// 原生 HTML5 拖拽跨列移动，复用 corePatchThread 状态机兜底校验。
// Yohaku：列头 serif、计数 mono caption、卡片 hairline 边框、空态虚线。
'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  THREAD_STATUSES,
  isThreadStatusTransitionAllowed,
  type ThreadStatus,
} from '@/lib/resonance/protocol'
import { patchThread } from '@/lib/threads'
import type { ThreadRow } from '@/lib/threads'

const COLUMN_LABELS: Record<ThreadStatus, string> = {
  open: 'Open',
  in_review: 'In Review',
  resolved: 'Resolved',
  archived: 'Archived',
}

interface ThreadBoardProps {
  realmId: string
  threads: ThreadRow[]
}

export default function ThreadBoard({
  realmId,
  threads: initialThreads,
}: ThreadBoardProps) {
  const router = useRouter()
  const [threads, setThreads] = useState(initialThreads)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const columns = THREAD_STATUSES.map((status) => ({
    status,
    items: threads.filter((t) => (t.status as ThreadStatus) === status),
  }))

  const handleDrop = useCallback(
    async (targetStatus: ThreadStatus) => {
      if (!draggingId) return
      const thread = threads.find((t) => t.id === draggingId)
      if (!thread) return
      setDraggingId(null)
      const currentStatus = thread.status as ThreadStatus
      if (currentStatus === targetStatus) return
      if (!isThreadStatusTransitionAllowed(currentStatus, targetStatus)) {
        setError(
          `${COLUMN_LABELS[currentStatus]} → ${COLUMN_LABELS[targetStatus]} 不是合法迁移`,
        )
        return
      }
      setError(null)
      // 乐观更新：先移动卡片，失败再回弹
      setThreads((prev) =>
        prev.map((t) =>
          t.id === thread.id ? { ...t, status: targetStatus } : t,
        ),
      )
      const result = await patchThread({
        realmId,
        threadId: thread.id,
        status: targetStatus,
      })
      if (!result.success) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === thread.id ? { ...t, status: thread.status } : t,
          ),
        )
        setError(result.error)
      } else {
        router.refresh()
      }
    },
    [draggingId, threads, realmId, router],
  )

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-md bg-accent/10 px-3 py-2 text-label-12 text-accent">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {columns.map((col) => (
          <section
            key={col.status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { void handleDrop(col.status) }}
            className="flex min-h-[12rem] flex-col rounded-md border border-border bg-neutral-1"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <p className="font-serif text-copy-14 font-medium text-neutral-9">
                {COLUMN_LABELS[col.status]}
              </p>
              <span className="font-mono text-caption-10 uppercase tracking-wider text-neutral-6">
                {col.items.length}
              </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {col.items.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
                  <p className="text-label-12 text-neutral-6">拖入卡片</p>
                </div>
              ) : (
                col.items.map((t) => (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={() => setDraggingId(t.id)}
                    onDragEnd={() => setDraggingId(null)}
                    className={`cursor-grab rounded-md border border-border bg-paper px-3 py-2 transition hover:bg-neutral-2 ${
                      draggingId === t.id ? 'opacity-50' : ''
                    }`}
                  >
                    <p className="truncate text-copy-13 text-neutral-9">
                      {t.title}
                    </p>
                    <p className="mt-1 font-mono text-caption-10 text-neutral-5">
                      {new Date(t.created_at).toLocaleDateString('zh-CN')}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
