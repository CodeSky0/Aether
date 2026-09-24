// @aether/web · 加入申请审批面板（Members tab 内）
// 展示 pending join requests，owner/admin 可批准/拒绝。
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/toast'
import {
  approveJoinRequest,
  rejectJoinRequest,
  type PendingJoinRequestRow,
} from '@/lib/team-join'

interface JoinRequestsPanelProps {
  realmId: string
  requests: PendingJoinRequestRow[]
}

export default function JoinRequestsPanel({
  realmId,
  requests,
}: JoinRequestsPanelProps) {
  const router = useRouter()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleApprove(requestId: string) {
    setBusyId(requestId)
    try {
      const result = await approveJoinRequest({ realmId, requestId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('已批准加入申请')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '审批失败')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(requestId: string) {
    setBusyId(requestId)
    try {
      const result = await rejectJoinRequest({ realmId, requestId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.info('已拒绝加入申请')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  if (requests.length === 0) return null

  return (
    <div className="mt-6 rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        加入申请（{requests.length}）
      </p>
      <div className="mt-4 divide-y divide-border">
        {requests.map((req) => (
          <div
            key={req.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-copy-14 text-neutral-9">{req.userName}</p>
              <p className="truncate font-mono text-label-12 text-neutral-6">
                {req.userEmail}
              </p>
              {req.message && (
                <p className="mt-1 text-label-12 text-neutral-7">
                  「{req.message}」
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={busyId === req.id}
                onClick={() => {
                  void handleApprove(req.id)
                }}
                className="btn-primary px-3 py-1.5 text-label-12"
              >
                {busyId === req.id ? '…' : '批准'}
              </button>
              <button
                type="button"
                disabled={busyId === req.id}
                onClick={() => {
                  void handleReject(req.id)
                }}
                className="btn-ghost px-3 py-1.5 text-label-12 text-error hover:text-error"
              >
                拒绝
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
