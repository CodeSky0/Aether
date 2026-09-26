// @aether/web · Git 分支选择器
// 编辑器头部组件：分支下拉切换 + 新建分支。
// Yohaku：mono 小字、1px border、neutral 色阶、梅红仅出现在当前分支标记。
'use client'

import { useState, useEffect, useRef } from 'react'
import { listBranches, createBranch } from '@/lib/git-actions'

interface GitBranchSelectorProps {
  realmId: string
  currentBranch: string
  onBranchChange: (branch: string) => void
}

export function GitBranchSelector({
  realmId,
  currentBranch,
  onBranchChange,
}: GitBranchSelectorProps) {
  const [branches, setBranches] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void listBranches(realmId).then((result) => {
      if (cancelled) return
      if (result.success && result.data) {
        setBranches(result.data.map((b) => b.name))
      }
    })
    return () => { cancelled = true }
  }, [realmId])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setError(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const result = await createBranch(realmId, currentBranch, newName.trim())
      if (!result.success) {
        setError(result.error)
        return
      }
      setBranches((prev) => [...prev, newName.trim()])
      onBranchChange(newName.trim())
      setNewName('')
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-label-12 text-neutral-7 transition hover:bg-neutral-2 hover:text-neutral-9"
      >
        <span className="text-neutral-5">⌥</span>
        <span className="truncate max-w-32">{currentBranch}</span>
        <span className="text-neutral-5">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-neutral-1 shadow-sm">
          <ul className="max-h-48 overflow-y-auto py-1">
            {branches.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => {
                    onBranchChange(name)
                    setOpen(false)
                  }}
                  className={`block w-full truncate px-3 py-1.5 text-left font-mono text-label-12 transition ${
                    name === currentBranch
                      ? 'text-accent'
                      : 'text-neutral-7 hover:bg-neutral-2 hover:text-neutral-9'
                  }`}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-2 py-2">
            <form onSubmit={(e) => { void handleCreate(e) }} className="flex gap-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="新分支名…"
                className="field flex-1 text-label-12"
                disabled={creating}
              />
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="btn-primary shrink-0 px-2 py-1 text-label-12"
              >
                {creating ? '…' : '创建'}
              </button>
            </form>
            {error && (
              <p className="mt-1 text-caption-10 text-error">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
