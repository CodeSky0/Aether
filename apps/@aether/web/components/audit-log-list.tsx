// @aether/web · 审计记录列表（客户端组件：过滤 + 分页加载）
// P1-7 修复：支持 actorType / action 过滤与"加载更多"分页
// Yohaku：过滤控件用 .field，记录以 hairline 台账形式呈现（audit-row）。
'use client'
import { useCallback, useEffect, useState } from 'react'
import { listAuditLogs, type AuditRow } from '@/lib/audit'
import AuditRowItem from '@/components/audit-row'
import type { ActorType, AuditAction } from '@aether/types'
const PAGE_SIZE = 50
interface AuditLogListProps {
  realmId: string
  initialLogs: AuditRow[]
}
const ACTOR_TYPE_OPTIONS: Array<{ value: ActorType | ''; label: string }> = [
  { value: '', label: '全部角色' },
  { value: 'human', label: '人' },
  { value: 'entity', label: 'Entity' },
]
const ACTION_OPTIONS: Array<{ value: AuditAction | ''; label: string }> = [
  { value: '', label: '全部操作' },
  { value: 'read', label: '读取' },
  { value: 'write', label: '写入' },
  { value: 'permission_change', label: '权限变更' },
  { value: 'converse', label: '对话' },
  { value: 'execute', label: '执行' },
]
export default function AuditLogList({ realmId, initialLogs }: AuditLogListProps) {
  const [logs, setLogs] = useState<AuditRow[]>(initialLogs)
  const [actorType, setActorType] = useState<ActorType | ''>('')
  const [action, setAction] = useState<AuditAction | ''>('')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(initialLogs.length >= PAGE_SIZE)
  const [offset, setOffset] = useState(initialLogs.length)
  const fetchLogs = useCallback(
    async (opts: { actorType: ActorType | ''; action: AuditAction | ''; limit: number; offset: number; append: boolean }) => {
      setLoading(true)
      try {
        const result = await listAuditLogs({
          realmId,
          limit: opts.limit,
          ...(opts.offset > 0 ? { offset: opts.offset } : {}),
          ...(opts.actorType ? { actorType: opts.actorType } : {}),
          ...(opts.action ? { action: opts.action } : {}),
        })
        if (opts.append) {
          setLogs((prev) => [...prev, ...result])
          setOffset((prev) => prev + result.length)
        } else {
          setLogs(result)
          setOffset(result.length)
        }
        setHasMore(result.length >= opts.limit)
      } finally {
        setLoading(false)
      }
    },
    [realmId],
  )
  // 过滤条件变化时重新加载
  useEffect(() => {
    void fetchLogs({ actorType, action, limit: PAGE_SIZE, offset: 0, append: false })
  }, [actorType, action, fetchLogs])
  const exportHref = (format: 'csv' | 'jsonl') => {
    const params = new URLSearchParams({ format })
    if (actorType) params.set('actorType', actorType)
    if (action) params.set('action', action)
    return `/api/realms/${realmId}/audit/export?${params.toString()}`
  }
  const handleLoadMore = () => {
    void fetchLogs({ actorType, action, limit: PAGE_SIZE, offset, append: true })
  }
  return (
    <div className="flex flex-col gap-5">
      {/* 过滤控件 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={actorType}
          onChange={(e) => setActorType(e.target.value as ActorType | '')}
          className="field w-auto py-1.5 text-copy-13"
        >
          {ACTOR_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | '')}
          className="field w-auto py-1.5 text-copy-13"
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="ml-1 text-label-12 text-neutral-6">
          共 {logs.length} 条{hasMore ? '+' : ''}
        </span>
        {/* 导出沿用当前过滤条件；导出范围是筛选结果全量，不受已加载页数限制 */}
        <span className="ml-auto flex items-center gap-2">
          <a
            href={exportHref('csv')}
            className="btn-ghost px-3 py-1.5 text-label-12"
          >
            导出 CSV
          </a>
          <a
            href={exportHref('jsonl')}
            className="btn-ghost px-3 py-1.5 text-label-12"
          >
            导出 JSONL
          </a>
        </span>
      </div>
      {/* 列表：hairline 台账 */}
      {logs.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-border bg-neutral-1 px-6 py-16 text-center">
          <p className="text-copy-14 text-neutral-7">暂无审计记录</p>
          <p className="mt-2 text-label-12 text-neutral-6">操作写入后将在此显示。</p>
        </div>
      ) : (
        <div className="border-t border-border">
          {logs.map((log) => (
            <AuditRowItem key={log.id} row={log} />
          ))}
        </div>
      )}
      {/* 加载更多 */}
      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loading}
          className="btn-ghost mx-auto px-5 py-1.5 text-label-12"
        >
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
    </div>
  )
}
