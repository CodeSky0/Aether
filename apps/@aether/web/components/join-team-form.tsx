// @aether/web · 加入团队表单（凭加入码申请，等待审批）
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { submitJoinRequest } from '@/lib/team-join'
import { useToast } from '@/components/ui/toast'

export default function JoinTeamForm() {
  const router = useRouter()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setSubmitting(true)
    try {
      const result = await submitJoinRequest({
        code: code.trim(),
        message: message.trim() || undefined,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        `已提交加入「${result.data.realmName}」的申请，等待管理员审批。`,
      )
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="mt-4 flex flex-col gap-3"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="加入码（如 ABCD2345）"
        className="field text-copy-16 uppercase tracking-widest"
        required
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="申请留言（可选）"
        className="field text-copy-14"
        rows={2}
        maxLength={500}
      />
      <button
        type="submit"
        disabled={submitting}
        className="btn-primary px-6 py-2.5 text-copy-16"
      >
        {submitting ? '提交中…' : '申请加入'}
      </button>
    </form>
  )
}
