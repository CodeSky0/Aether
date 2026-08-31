// @aether/web · MembersTable — Realm 成员表格（Yohaku）
// spec 契约：
//   列：Avatar · Name/Email · Role · Joined · Actions
//   Role Badge：owner text-neutral-10 font-medium / admin text-neutral-8 /
//               member text-neutral-7 / viewer text-neutral-6 text-xs uppercase
//   行 hover bg-neutral-2；分隔 border-b border-border
//   Actions：角色变更（owner only）· 移除（admin+，不可移除 owner）
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DataTable, { type DataTableColumn } from '@/components/ui/data-table'
import RoleSelect, { type RealmRole } from '@/components/ui/role-select'
import { useToast } from '@/components/ui/toast'
import {
  removeRealmMember,
  updateRealmMemberRole,
  type RealmMemberRow,
} from '@/app/actions/membership'

interface MembersTableProps {
  realmId: string
  members: RealmMemberRow[]
  currentActorRole: string
}

function RoleBadge({ role }: { role: string }) {
  switch (role) {
    case 'owner':
      return <span className="text-neutral-10 font-medium">Owner</span>
    case 'admin':
      return <span className="text-neutral-8">Admin</span>
    case 'member':
      return <span className="text-neutral-7">Member</span>
    case 'viewer':
      return (
        <span className="text-xs uppercase text-neutral-6">Viewer</span>
      )
    default:
      return <span className="text-neutral-6">{role}</span>
  }
}

function Avatar({ actorId }: { actorId: string }) {
  const initial = actorId.charAt(0).toUpperCase() || '?'
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-3 text-copy-13 font-medium text-neutral-7">
      {initial}
    </span>
  )
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(
    new Date(value),
  )
}

export default function MembersTable({
  realmId,
  members,
  currentActorRole,
}: MembersTableProps) {
  const router = useRouter()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const isOwner = currentActorRole === 'owner'
  const canManage = currentActorRole === 'owner' || currentActorRole === 'admin'

  async function handleRoleChange(member: RealmMemberRow, role: RealmRole) {
    if (!isOwner) return
    setBusyId(member.id)
    try {
      const result = await updateRealmMemberRole({
        realmId,
        userId: member.actor_id,
        role,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`已将成员角色变更为 ${role}`)
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '角色变更失败')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(member: RealmMemberRow) {
    if (!canManage) return
    setBusyId(member.id)
    try {
      const result = await removeRealmMember({
        realmId,
        userId: member.actor_id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('成员已移除')
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '移除失败')
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<DataTableColumn<RealmMemberRow>> = [
    {
      key: 'member',
      header: '成员',
      render: (member) => (
        <div className="flex items-center gap-3">
          <Avatar actorId={member.actor_id} />
          <div className="min-w-0">
            <p className="text-copy-14 text-neutral-9">
              {member.actor_type === 'entity' ? 'Entity' : '成员'}
            </p>
            <p className="truncate font-mono text-label-12 text-neutral-6">
              {member.actor_id}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: '角色',
      render: (member) => <RoleBadge role={member.role} />,
    },
    {
      key: 'joined',
      header: '加入时间',
      render: (member) => (
        <span className="font-mono text-label-12 text-neutral-6">
          {formatDate(member.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (member) => {
        if (!canManage) return null
        const isMemberOwner = member.role === 'owner'
        return (
          <div className="flex items-center justify-end gap-2">
            {isOwner && !isMemberOwner && member.actor_type === 'human' && (
              <RoleSelect
                value={member.role as RealmRole}
                onChange={(role) => { void handleRoleChange(member, role) }}
                disabled={busyId === member.id}
                exclude={['owner']}
              />
            )}
            {!isMemberOwner && member.actor_type === 'human' && (
              <button
                type="button"
                disabled={busyId === member.id}
                onClick={() => { void handleRemove(member) }}
                className="btn-ghost text-error hover:text-error"
              >
                {busyId === member.id ? '…' : '移除'}
              </button>
            )}
          </div>
        )
      },
    },
  ]

  if (members.length === 0) {
    return <p className="py-6 text-center text-copy-14 text-neutral-6">暂无成员。</p>
  }

  return (
    <DataTable
      columns={columns}
      rows={members}
      rowKey={(member) => member.id}
    />
  )
}
