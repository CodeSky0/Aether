// @aether/web · /realms/[id]/members 页面：成员管理与 Realm 邀请
// 成员与邀请读取失败时保留页面骨架，并展示可操作的中文提示。
import {
  listRealmInvitations,
  listRealmMembers,
} from '@/app/actions/membership'
import InviteRealmMemberForm from '@/components/invite-realm-member-form'
import RealmInvitationList from '@/components/realm-invitation-list'
import RealmMemberList from '@/components/realm-member-list'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import { listRealms } from '@/lib/realms'
import { UNBOUND_REALM_ORGANIZATION_MESSAGE } from '@/lib/membership-utils'
import { MEMBERSHIP_DENIED_MESSAGE_PREFIX } from '@/lib/membership-guard'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

// 只放行本仓库自己产出、且对当前访问者可公开的文案；驱动/配置错误一律收敛成通用提示，
// 避免把内部配置与数据库细节透给无权访问该 Realm 的访问者。
function renderLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === UNBOUND_REALM_ORGANIZATION_MESSAGE) {
    return 'Realm 尚未绑定真实 organization，请先运行回填脚本 backfill:realm-orgs。'
  }
  if (message.startsWith(MEMBERSHIP_DENIED_MESSAGE_PREFIX)) {
    return '当前账号没有查看该 Realm 成员的权限。'
  }
  return '读取失败，请稍后重试或联系 Realm 管理员。'
}

export default async function MembersPage({ params }: PageProps) {
  const { id: realmId } = await params
  const realms = await listRealms()
  const realm = realms.find((candidate) => candidate.id === realmId)
  if (!realm) notFound()

  const [memberResult, invitationResult] = await Promise.allSettled([
    listRealmMembers({ realmId }),
    listRealmInvitations({ realmId }),
  ])
  const memberData =
    memberResult.status === 'fulfilled' ? memberResult.value : null
  const invitations =
    invitationResult.status === 'fulfilled' ? invitationResult.value : null

  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <div className="mx-auto max-w-4xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow={realm.slug}
          title="成员管理"
          description={`${realm.name} 的 Aether membership 与待处理邀请。`}
        />
        {(memberResult.status === 'rejected' ||
          invitationResult.status === 'rejected') && (
          <div className="mb-6 space-y-2 rounded-md bg-warning/10 p-4 text-label-12 text-neutral-8">
            {memberResult.status === 'rejected' && (
              <p>成员列表：{renderLoadError(memberResult.reason)}</p>
            )}
            {invitationResult.status === 'rejected' && (
              <p>邀请列表：{renderLoadError(invitationResult.reason)}</p>
            )}
          </div>
        )}
        {memberData && (
          <>
            <InviteRealmMemberForm
              realmId={realmId}
              currentActorRole={memberData.currentActorRole}
            />
            <div className="mt-6">
              <RealmMemberList members={memberData.members} />
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
    </NavShell>
  )
}
