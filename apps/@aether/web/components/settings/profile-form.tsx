// @aether/web · Profile 表单（改名/邮箱）
// Step 2 契约：服务端失败经 Toast（suoh）反馈，成功 wakatake。
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProfile } from '@/app/actions/profile'
import { useToast } from '@/components/ui/toast'

interface ProfileFormProps {
  initialName: string
  initialEmail: string
}

export default function ProfileForm({
  initialName,
  initialEmail,
}: ProfileFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const result = await updateProfile({
        name: name.trim(),
        email: email.trim(),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('身份已更新')
      router.refresh()
    } catch (err) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(err instanceof Error ? err.message : '更新失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        身份
      </p>
      <form
        onSubmit={(e) => { void handleSubmit(e) }}
        className="mt-4 flex flex-col gap-3"
      >
        <label className="block">
          <span className="text-label-12 text-neutral-6">名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field mt-1 w-full"
            required
          />
        </label>
        <label className="block">
          <span className="text-label-12 text-neutral-6">邮箱</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field mt-1 w-full font-mono text-copy-13"
            required
          />
        </label>
        <div>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </section>
  )
}
