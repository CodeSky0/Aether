// @aether/web · PR Review Panel
// Review 列表 + approve / request changes / merge 按钮 + 评论输入。
// Yohaku：mono 小字、1px border、梅红仅出现在 merge 按钮。
'use client'
import { useState, useCallback } from 'react'
import type { PRReview, PRComment } from '@/lib/github-api'
import { approvePR, requestChanges, mergePR, addPRComment } from '@/lib/pr-actions'

interface PrReviewPanelProps {
  realmId: string
  prNumber: number
  prState: string
  reviews: PRReview[]
  comments: PRComment[]
  onActionComplete?: () => void
}

const REVIEW_STATE_LABEL: Record<string, string> = {
  APPROVED: '已通过',
  CHANGES_REQUESTED: '请求修改',
  COMMENTED: '评论',
  DISMISSED: '已驳回',
  PENDING: '待定',
}

export function PrReviewPanel({
  realmId,
  prNumber,
  prState,
  reviews,
  comments,
  onActionComplete,
}: PrReviewPanelProps) {
  const [body, setBody] = useState('')
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAction = useCallback(
    async (action: 'approve' | 'request_changes' | 'merge' | 'comment') => {
      setActing(true)
      setError(null)
      try {
        if (action === 'approve') {
          const r = await approvePR(realmId, prNumber, body.trim() || undefined)
          if (!r.success) { setError(r.error); return }
        } else if (action === 'request_changes') {
          const r = await requestChanges(realmId, prNumber, body.trim() || undefined)
          if (!r.success) { setError(r.error); return }
        } else if (action === 'merge') {
          const r = await mergePR(realmId, prNumber)
          if (!r.success) { setError(r.error); return }
        } else {
          if (!body.trim()) return
          const r = await addPRComment(realmId, prNumber, body.trim())
          if (!r.success) { setError(r.error); return }
        }
        setBody('')
        onActionComplete?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setActing(false)
      }
    },
    [realmId, prNumber, body, onActionComplete],
  )

  const canMerge = prState === 'open'

  return (
    <div className="flex flex-col gap-3">
      {/* Reviews */}
      {reviews.length > 0 && (
        <div>
          <p className="shrink-0 pb-1 pt-2 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
            Reviews
          </p>
          <ul className="flex flex-col gap-1.5">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-label-12 text-neutral-9">{review.reviewer}</span>
                  <span className="font-mono text-caption-10 text-neutral-6">
                    {REVIEW_STATE_LABEL[review.state] ?? review.state}
                  </span>
                  <span className="ml-auto font-mono text-caption-10 text-neutral-5">
                    {new Date(review.submitted_at).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                {review.body && (
                  <p className="mt-1 text-copy-13 text-neutral-7">{review.body}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Comments */}
      {comments.length > 0 && (
        <div>
          <p className="shrink-0 pb-1 pt-2 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
            行内评论
          </p>
          <ul className="flex flex-col gap-1.5">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-label-12 text-neutral-9">{comment.author}</span>
                  <span className="truncate font-mono text-caption-10 text-neutral-6">
                    {comment.path}
                    {comment.line !== null ? `:${comment.line}` : ''}
                  </span>
                </div>
                <p className="mt-1 text-copy-13 text-neutral-7">{comment.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action bar */}
      <div className="rounded-md border border-border px-3 py-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="评论内容（可选）…"
          className="field mb-2 min-h-20 w-full text-copy-13"
          disabled={acting}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={acting}
            onClick={() => { void handleAction('approve') }}
            className="btn-primary px-3 py-1.5 text-label-12"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => { void handleAction('request_changes') }}
            className="rounded-md border border-border px-3 py-1.5 text-label-12 text-neutral-7 transition hover:bg-neutral-2"
          >
            Request Changes
          </button>
          <button
            type="button"
            disabled={acting || !body.trim()}
            onClick={() => { void handleAction('comment') }}
            className="rounded-md border border-border px-3 py-1.5 text-label-12 text-neutral-7 transition hover:bg-neutral-2"
          >
            评论
          </button>
          {canMerge && (
            <button
              type="button"
              disabled={acting}
              onClick={() => { void handleAction('merge') }}
              className="ml-auto rounded-md bg-green-6 px-3 py-1.5 text-label-12 text-white transition hover:bg-green-7"
            >
              Merge
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-label-12 text-error">{error}</p>}
      </div>
    </div>
  )
}
