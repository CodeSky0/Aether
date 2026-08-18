// @aether/web · Realm 待处理邀请列表
// 撤销操作仍经服务端校验 organization 所属 Realm，客户端不承担授权边界。
'use client'

import {
  revokeRealmInvitation,
  type RealmInvitation,
} from '@/app/actions/membership'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface RealmInvitationListProps {
  realmId: string
  invitations: RealmInvitation[]
  currentActorRole: string
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function RealmInvitationList({
  realmId,
  invitations,
  currentActorRole,
}: RealmInvitationListProps) {
  const router = useRouter()
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 邀请列表对 member 可读，但撤销要求 owner / admin：无权者不显示按钮而不是点了才报错。
  const canRevoke =
    currentActorRole === 'owner' || currentActorRole === 'admin'

  async function revoke(invitationId: string) {
    setRevokingId(invitationId)
    setError(null)
    try {
      await revokeRealmInvitation({ realmId, invitationId })
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销邀请失败')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        邀请记录
      </p>
      {error && <p className="mt-3 text-label-12 text-error">{error}</p>}
      {invitations.length === 0 ? (
        <p className="mt-4 text-copy-14 text-neutral-6">暂无邀请。</p>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-copy-14 text-neutral-9">{invitation.email}</p>
                <p className="mt-1 text-label-12 text-neutral-6">
                  {invitation.role} · {invitation.status} · 过期于{' '}
                  {formatDate(invitation.expiresAt)}
                </p>
              </div>
              {canRevoke && invitation.status === 'pending' && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={revokingId === invitation.id}
                  onClick={() => {
                    void revoke(invitation.id)
                  }}
                >
                  {revokingId === invitation.id ? '撤销中…' : '撤销'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
