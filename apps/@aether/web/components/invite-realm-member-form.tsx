// @aether/web · Realm 成员邀请表单
// 服务端 Action 负责认证与授权，客户端只负责输入、状态和刷新。
'use client'

import { inviteRealmMember } from '@/app/actions/membership'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/toast'

interface InviteRealmMemberFormProps {
  realmId: string
  currentActorRole: string
}

const ROLES = ['owner', 'admin', 'member'] as const

export default function InviteRealmMemberForm({
  realmId,
  currentActorRole,
}: InviteRealmMemberFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('member')
  const [submitting, setSubmitting] = useState(false)
  const canInvite = currentActorRole === 'owner' || currentActorRole === 'admin'

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    try {
      const result = await inviteRealmMember({ realmId, email: email.trim(), role })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setEmail('')
      toast.success(`邀请已发送至 ${email.trim()}`)
      router.refresh()
    } catch (caught) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(caught instanceof Error ? caught.message : '邀请发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (!canInvite) return null

  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        邀请成员
      </p>
      <form
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
        className="mt-3 flex flex-wrap items-start gap-2"
      >
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          placeholder="成员邮箱"
          className="field min-w-56 flex-1"
          required
        />
        <select
          value={role}
          onChange={(event) => {
            const nextRole = ROLES.find((option) => option === event.target.value)
            if (nextRole) setRole(nextRole)
          }}
          className="field"
        >
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? '发送中…' : '发送邀请'}
        </button>
      </form>
    </section>
  )
}
