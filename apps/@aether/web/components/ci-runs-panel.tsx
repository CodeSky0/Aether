// @aether/web · CI Runs 面板
// check runs 列表：name / status / conclusion / 耗时 / 可点击跳转 GitHub。
'use client'
import type { CheckRun } from '@/lib/github-api'

interface CiRunsPanelProps {
  runs: CheckRun[]
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  in_progress: '进行中',
  completed: '已完成',
}

const CONCLUSION_COLOR: Record<string, string> = {
  success: 'text-green-6',
  failure: 'text-red-6',
  neutral: 'text-neutral-6',
  cancelled: 'text-neutral-5',
  timed_out: 'text-red-6',
}

function formatDuration(started: string | null, completed: string | null): string {
  if (!started || !completed) return '—'
  const ms = new Date(completed).getTime() - new Date(started).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export function CiRunsPanel({ runs }: CiRunsPanelProps) {
  if (runs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
        <p className="text-copy-13 text-neutral-7">无 CI 记录</p>
        <p className="mt-1 text-label-12 text-neutral-6">
          GitHub Actions / check runs 结果将显示在此。
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {runs.map((run) => (
        <li
          key={run.id}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
        >
          <span
            className={`shrink-0 font-mono text-label-12 ${
              run.conclusion
                ? (CONCLUSION_COLOR[run.conclusion] ?? 'text-neutral-6')
                : 'text-yellow-6'
            }`}
          >
            {run.conclusion === 'success' ? '✓' : run.conclusion === 'failure' ? '✗' : '○'}
          </span>
          <span className="min-w-0 truncate font-mono text-label-12 text-neutral-9">
            {run.name}
          </span>
          <span className="ml-auto shrink-0 font-mono text-caption-10 text-neutral-6">
            {STATUS_LABEL[run.status] ?? run.status}
          </span>
          <span className="shrink-0 font-mono text-caption-10 text-neutral-5">
            {formatDuration(run.started_at, run.completed_at)}
          </span>
          {run.html_url && (
            <a
              href={run.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 font-mono text-caption-10 text-neutral-5 hover:text-neutral-7"
            >
              ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}
