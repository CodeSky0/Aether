// @aether/web · Git 提交栏
// 编辑器头部下方：commit message 输入 + 提交按钮。
// 提交流程：向 editor-host iframe 请求当前文本 → commitFile Server Action → GitHub API 6 步创建 commit。
// Yohaku：mono 小字、1px border、梅红仅出现在提交按钮。
'use client'

import { useState, useCallback } from 'react'
import { commitFile } from '@/lib/git-actions'

interface GitCommitBarProps {
  realmId: string
  activePath: string
  branch: string
  /** 向 editor-host iframe 请求当前文本内容 */
  requestEditorSave: () => Promise<string | null>
  onCommitted?: () => void
}

export function GitCommitBar({
  realmId,
  activePath,
  branch,
  requestEditorSave,
  onCommitted,
}: GitCommitBarProps) {
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSha, setLastSha] = useState<string | null>(null)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setCommitting(true)
    setError(null)
    setLastSha(null)
    try {
      const content = await requestEditorSave()
      if (content === null) {
        setError('无法获取编辑器内容（超时），请重试')
        return
      }
      const result = await commitFile(realmId, activePath, content, message.trim())
      if (!result.success) {
        setError(result.error)
        return
      }
      if (result.data === null) {
        setError('未配置 GitHub 集成，无法提交')
        return
      }
      setLastSha(result.data.sha.slice(0, 7))
      setMessage('')
      onCommitted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }, [realmId, activePath, message, requestEditorSave, onCommitted])

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-neutral-1 px-4">
      <form onSubmit={(e) => { void handleSubmit(e) }} className="flex flex-1 items-center gap-2">
        <span className="shrink-0 font-mono text-caption-10 text-neutral-5">
          {branch}
        </span>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`提交 ${activePath}…`}
          className="field flex-1 text-label-12"
          disabled={committing}
        />
        <button
          type="submit"
          disabled={committing || !message.trim()}
          className="btn-primary shrink-0 px-3 py-1 text-label-12"
        >
          {committing ? '提交中…' : '提交'}
        </button>
      </form>
      {lastSha && (
        <span className="shrink-0 font-mono text-caption-10 text-green-6">
          ✓ {lastSha}
        </span>
      )}
      {error && (
        <span className="shrink-0 truncate font-mono text-caption-10 text-error" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
