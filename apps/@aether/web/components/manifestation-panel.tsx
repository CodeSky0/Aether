// @aether/web · Manifestation 协同审查面板
// 嵌入预览 iframe + 元素级圈选标注 + 评论→Thread 自动闭环。
// 愿景下午 2:00 场景：产品经理在 Current 里看预览，圈出按钮位置留评论，
// 评论自动变成 Thread 并绑定 manifestation_url + 标注坐标。
// Yohaku：serif 标题、mono 坐标、梅红标注点（≤ 5%），评论框 neutral 底。
'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { createThread } from '@/lib/threads'

interface ManifestationPanelProps {
  manifestationUrl: string
  realmId: string
  defaultProjectId: string
  threadTitle?: string
  onClose?: () => void
}

/** 预览标注：坐标用百分比（相对 iframe），跨屏幕尺寸一致 */
interface PreviewAnnotation {
  id: string
  /** 相对 iframe 宽的百分比 0-100 */
  x: number
  /** 相对 iframe 高的百分比 0-100 */
  y: number
  comment: string
  threadId?: string
  authorId: string
  createdAt: number
}

type Mode = 'browse' | 'annotate'

export default function ManifestationPanel({
  manifestationUrl,
  realmId,
  defaultProjectId,
  threadTitle = 'Manifestation 审查',
  onClose,
}: ManifestationPanelProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('browse')
  const [annotations, setAnnotations] = useState<PreviewAnnotation[]>([])
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (mode !== 'annotate') return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      setPendingPos({ x, y })
      setComment('')
      setError(null)
    },
    [mode],
  )

  async function handleSubmitAnnotation() {
    if (!pendingPos || !comment.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createThread({
        realmId,
        projectId: defaultProjectId,
        title: `预览标注：${comment.trim().slice(0, 40)}`,
        manifestationUrl,
        codeAnchor: JSON.stringify({
          type: 'preview-annotation',
          x: pendingPos.x,
          y: pendingPos.y,
          url: manifestationUrl,
        }),
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      const newAnn: PreviewAnnotation = {
        id: `ann-${Date.now()}`,
        x: pendingPos.x,
        y: pendingPos.y,
        comment: comment.trim(),
        threadId: result.data.id,
        authorId: 'web-client',
        createdAt: Date.now(),
      }
      setAnnotations((prev) => [...prev, newAnn])
      setPendingPos(null)
      setComment('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-1">
      {/* 标题栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <p className="min-w-0 truncate font-serif text-copy-14 font-medium text-neutral-9">
          {threadTitle}
        </p>
        <span className="shrink-0 font-mono text-caption-10 uppercase tracking-wider text-neutral-5">
          Manifestation
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* 模式切换 */}
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'annotate' ? 'browse' : 'annotate'))}
            className={`rounded-md px-3 py-1 text-label-12 transition ${
              mode === 'annotate'
                ? 'bg-accent text-white'
                : 'bg-neutral-2 text-neutral-7 hover:text-neutral-9'
            }`}
          >
            {mode === 'annotate' ? '标注中' : '标注'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md px-2 py-1 text-label-12 text-neutral-6 hover:bg-neutral-2 hover:text-neutral-9"
              aria-label="关闭预览"
            >
              Esc
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 预览区 + 标注覆盖层 */}
        <div ref={containerRef} className="relative min-w-0 flex-1">
          <iframe
            ref={iframeRef}
            src={manifestationUrl}
            className="h-full w-full border-0"
            title="Manifestation Preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
          {/* 标注覆盖层：annotate 模式捕获点击，browse 模式 pointer-events-none */}
          <div
            className={`absolute inset-0 ${
              mode === 'annotate' ? 'cursor-crosshair' : 'pointer-events-none'
            }`}
            onClick={handleOverlayClick}
          >
            {/* 已有标注点 */}
            {annotations.map((ann) => (
              <div
                key={ann.id}
                className="group absolute"
                style={{ left: `${ann.x}%`, top: `${ann.y}%` }}
              >
                <span className="block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-neutral-1" />
                <div className="absolute left-3 top-3 hidden max-w-48 rounded-md bg-neutral-1 px-2 py-1 text-label-12 text-neutral-8 shadow-whisper ring-1 ring-border group-hover:block">
                  {ann.comment}
                </div>
              </div>
            ))}
            {/* 待提交的评论框 */}
            {pendingPos && (
              <div
                className="absolute z-10"
                style={{ left: `${pendingPos.x}%`, top: `${pendingPos.y}%` }}
              >
                <div className="-translate-x-1/2 -translate-y-1/2 rounded-md bg-neutral-1 p-2 shadow-whisper ring-1 ring-accent">
                  <span className="mb-1 block h-2 w-2 rounded-full bg-accent" />
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void handleSubmitAnnotation()
                      }
                      if (e.key === 'Escape') {
                        setPendingPos(null)
                        setComment('')
                      }
                    }}
                    placeholder="评论…（Enter 提交）"
                    disabled={submitting}
                    className="w-48 resize-none rounded bg-neutral-1 px-2 py-1 text-label-12 text-neutral-9 ring-1 ring-border focus:outline-none focus:ring-accent"
                    rows={2}
                    autoFocus
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPendingPos(null); setComment('') }}
                      className="rounded px-2 py-0.5 text-caption-10 text-neutral-6 hover:bg-neutral-2"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleSubmitAnnotation() }}
                      disabled={submitting || !comment.trim()}
                      className="btn-primary text-caption-10"
                    >
                      {submitting ? '…' : '提交'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* 模式提示 */}
          {mode === 'annotate' && !pendingPos && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-accent/90 px-3 py-1 text-label-12 text-white">
              点击预览页面标注元素
            </div>
          )}
          {error && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-error/10 px-3 py-1 text-label-12 text-error">
              {error}
            </div>
          )}
        </div>

        {/* 标注列表 */}
        {annotations.length > 0 && (
          <aside className="flex w-48 shrink-0 flex-col border-l border-border bg-neutral-1 lg:w-56">
            <p className="shrink-0 px-4 pb-1 pt-4 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
              标注 · {annotations.length}
            </p>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {annotations.map((ann, i) => (
                <li key={ann.id} className="mb-2 rounded-md bg-neutral-2 px-2 py-1.5">
                  <p className="mb-0.5 font-mono text-caption-10 text-neutral-5">
                    #{i + 1} · {ann.x.toFixed(1)}%, {ann.y.toFixed(1)}%
                  </p>
                  <p className="text-label-12 text-neutral-8">{ann.comment}</p>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}
