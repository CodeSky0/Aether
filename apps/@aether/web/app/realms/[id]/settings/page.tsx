// @aether/web · /realms/[id]/settings：通用设置（General tab）
// NavShell / PageHeader / TabNav 由 settings/layout.tsx 提供，本页只渲染内容区。
import Link from 'next/link'

import RenameRealmForm from '@/components/settings/rename-realm-form'
import ApiKeysPanel from '@/components/settings/api-keys-panel'
import DangerZone from '@/components/settings/danger-zone'
import { unwrapOr } from '@/lib/action-result'
import { getRealm } from '@/lib/realms'
import { listApiKeys } from '@/lib/api-keys'
import { listRealmMembers } from '@/app/actions/membership'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function RealmGeneralSettingsPage({ params }: PageProps) {
  const { id: realmId } = await params
  const realm = unwrapOr(await getRealm(realmId), null)
  if (!realm) return null

  const membersResult = await listRealmMembers({ realmId })
  const currentActorRole = membersResult.success
    ? membersResult.data.currentActorRole
    : null
  const keys = unwrapOr(await listApiKeys({ realmId }), [])
  const isOwner = currentActorRole === 'owner'

  return (
    <div className="flex flex-col gap-6">
      <RenameRealmForm
        realmId={realm.id}
        initialName={realm.name}
        canRename={currentActorRole === 'owner' || currentActorRole === 'admin'}
      />

      <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
        <div className="flex items-center justify-between">
          <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
            成员
          </p>
          <Link
            href={`/realms/${realm.id}/settings/members`}
            className="btn-ghost"
          >
            管理成员
          </Link>
        </div>
        <p className="mt-3 text-copy-14 text-neutral-7">
          邀请人类成员、查看角色与作用域。
        </p>
      </section>

      <ApiKeysPanel
        realmId={realm.id}
        initialKeys={keys}
        canManage={currentActorRole === 'owner' || currentActorRole === 'admin'}
      />

      <DangerZone realmId={realm.id} realmName={realm.name} isOwner={isOwner} />
    </div>
  )
}
