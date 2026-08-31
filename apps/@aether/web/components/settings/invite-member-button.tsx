// @aether/web · 邀请成员触发器（按钮 + Modal 状态管理）
'use client'

import { useState } from 'react'
import InviteModal from '@/components/settings/invite-modal'

interface InviteMemberButtonProps {
  realmId: string
  canInvite: boolean
}

export default function InviteMemberButton({
  realmId,
  canInvite,
}: InviteMemberButtonProps) {
  const [open, setOpen] = useState(false)
  if (!canInvite) return null
  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
          邀请成员
        </p>
        <button type="button" onClick={() => setOpen(true)} className="btn-primary">
          邀请成员
        </button>
      </div>
      <p className="mt-3 text-copy-14 text-neutral-7">
        通过邮箱邀请新成员加入 Realm，并指定其角色。
      </p>
      <InviteModal realmId={realmId} open={open} onClose={() => setOpen(false)} />
    </section>
  )
}
