// @aether/web · InviteModal — Realm 成员邀请对话框
// Yohaku 契约（Phase Shift Step 5）：
//   Backdrop：bg-neutral-10/50 backdrop-blur-sm（由 Modal 原语提供）
//   Email input：.field（focus:ring-accent）
//   Role selector：RoleSelect 自定义下拉（无 native select）
//   Button：.btn-primary（bg-accent text-white，主操作罕见使用主色）
'use client'

import { useState } from 'react'
import Modal from '@/components/ui/modal'
import RoleSelect, { type RealmRole } from '@/components/ui/role-select'
import { useToast } from '@/components/ui/toast'
import { useRouter } from 'next/navigation'
import { inviteRealmMember } from '@/app/actions/membership'

interface InviteModalProps {
  realmId: string
  open: boolean
  onClose: () => void
}

export default function InviteModal({ realmId, open, onClose }: InviteModalProps) {
  const router = useRouter()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RealmRole>('member')
  const [submitting, setSubmitting] = useState(false)

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
      setRole('member')
      toast.success(`邀请已发送至 ${email.trim()}`)
      onClose()
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '邀请发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="邀请成员"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            取消
          </button>
          <button
            type="submit"
            form="invite-member-form"
            disabled={submitting}
            className="btn-primary"
          >
            {submitting ? '发送中…' : '发送邀请'}
          </button>
        </>
      }
    >
      <form id="invite-member-form" onSubmit={(e) => { void handleSubmit(e) }} className="space-y-4">
        <div>
          <label
            htmlFor="invite-email"
            className="block pb-1.5 text-label-12 text-neutral-7"
          >
            邮箱
          </label>
          <input
            id="invite-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            placeholder="member@example.com"
            className="field w-full"
            required
          />
        </div>
        <div>
          <label
            htmlFor="invite-role"
            className="block pb-1.5 text-label-12 text-neutral-7"
          >
            角色
          </label>
          <RoleSelect
            value={role}
            onChange={setRole}
            exclude={['owner']}
            className="w-full"
          />
        </div>
      </form>
    </Modal>
  )
}
