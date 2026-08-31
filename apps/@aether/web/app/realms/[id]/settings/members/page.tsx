// @aether/web · /realms/[id]/settings/members：成员管理（Members tab）
// NavShell / PageHeader / TabNav 由 settings/layout.tsx 提供。
// 成员与邀请读取失败时保留骨架，并展示可操作的中文提示。
import {
  listRealmInvitations,
  listRealmMembers,
} from '@/app/actions/membership'
import InviteMemberButton from '@/components/settings/invite-member-button'
import RealmInvitationList from '@/components/realm-invitation-list'
import MembersTable from '@/components/settings/members-table'
import { UNBOUND_REALM_ORGANIZATION_MESSAGE } from '@/lib/membership-utils'
import { MEMBERSHIP_DENIED_MESSAGE_PREFIX } from '@/lib/membership-guard'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

function renderLoadError(message: string): string {
  if (message === UNBOUND_REALM_ORGANIZATION_MESSAGE) {
    return 'Realm 尚未绑定真实 organization，请先运行回填脚本 backfill:realm-orgs。'
  }
  if (message.startsWith(MEMBERSHIP_DENIED_MESSAGE_PREFIX)) {
    return '当前账号没有查看该 Realm 成员的权限。'
  }
  return '读取失败，请稍后重试或联系 Realm 管理员。'
}

export default async function MembersSettingsPage({ params }: PageProps) {
  const { id: realmId } = await params

  const [memberResult, invitationResult] = await Promise.all([
    listRealmMembers({ realmId }),
    listRealmInvitations({ realmId }),
  ])
  const memberData = memberResult.success ? memberResult.data : null
  const invitations = invitationResult.success ? invitationResult.data : null

  return (
    <div>
      {(!memberResult.success || !invitationResult.success) && (
        <div className="mb-6 space-y-2 rounded-md bg-warning/10 p-4 text-label-12 text-neutral-8">
          {!memberResult.success && (
            <p>成员列表：{renderLoadError(memberResult.error)}</p>
          )}
          {!invitationResult.success && (
            <p>邀请列表：{renderLoadError(invitationResult.error)}</p>
          )}
        </div>
      )}
      {memberData && (
        <>
          <InviteMemberButton
            realmId={realmId}
            canInvite={
              memberData.currentActorRole === 'owner' ||
              memberData.currentActorRole === 'admin'
            }
          />
          <div className="mt-6 rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
            <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
              Aether 成员
            </p>
            <div className="mt-4">
              <MembersTable
                realmId={realmId}
                members={memberData.members}
                currentActorRole={memberData.currentActorRole}
              />
            </div>
          </div>
        </>
      )}
      {invitations && (
        <div className="mt-6">
          <RealmInvitationList
            realmId={realmId}
            invitations={invitations}
            currentActorRole={memberData?.currentActorRole ?? ''}
          />
        </div>
      )}
    </div>
  )
}
