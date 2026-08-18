// @aether/web · Realm 成员邀请表单
// 服务端 Action 负责认证与授权，客户端只负责输入、状态和刷新。
'use client'

import { inviteRealmMember } from '@/app/actions/membership'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

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
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('member')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const canInvite = currentActorRole === 'owner' || currentActorRole === 'admin'

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    setSent(false)
    try {
      await inviteRealmMember({ realmId, email: email.trim(), role })
      setEmail('')
      setSent(true)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邀请发送失败')
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
        {error && <p className="w-full text-label-12 text-error">{error}</p>}
        {sent && (
          <p className="w-full text-label-12 text-success">邀请已发送。</p>
        )}
      </form>
    </section>
  )
}
