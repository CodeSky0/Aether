// @aether/web · CI 状态徽章
// 根据 check runs 聚合整体状态：全绿 / 有红 / 进行中 / 无数据。
'use client'
import type { CheckRun } from '@/lib/github-api'

interface CiStatusBadgeProps {
  runs: CheckRun[]
}

export function CiStatusBadge({ runs }: CiStatusBadgeProps) {
  if (runs.length === 0) {
    return (
      <span className="rounded px-1.5 py-0.5 font-mono text-caption-10 text-neutral-5">
        CI 无数据
      </span>
    )
  }

  const hasFailure = runs.some(
    (r) => r.status === 'completed' && r.conclusion === 'failure',
  )
  const hasInProgress = runs.some((r) => r.status !== 'completed')
  const allSuccess = runs.every(
    (r) => r.status === 'completed' && r.conclusion === 'success',
  )

  const label = hasInProgress ? 'CI 进行中' : hasFailure ? 'CI 失败' : allSuccess ? 'CI 通过' : 'CI 完成'
  const color = hasInProgress
    ? 'bg-yellow-6/10 text-yellow-6'
    : hasFailure
      ? 'bg-red-6/10 text-red-6'
      : allSuccess
        ? 'bg-green-6/10 text-green-6'
        : 'bg-neutral-2 text-neutral-6'

  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-caption-10 ${color}`}>
      {label}
    </span>
  )
}
