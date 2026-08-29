// @aether/web · /realms/[id]/settings：Realm 设置（Step 4）
// 三个区：改名 / API Keys（Resonance 预备）/ Danger Zone（DELETE 确认软删除）。
// 成员管理已有独立页（/realms/[id]/members），此处给入口链接。
import Link from 'next/link'
import { notFound } from 'next/navigation'

import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import RenameRealmForm from '@/components/settings/rename-realm-form'
import ApiKeysPanel from '@/components/settings/api-keys-panel'
import DangerZone from '@/components/settings/danger-zone'
import { unwrapOr } from '@/lib/action-result'
import { listApiKeys } from '@/lib/api-keys'
import { getRealm } from '@/lib/realms'
import { listRealmMembers } from '@/app/actions/membership'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function RealmSettingsPage({ params }: PageProps) {
  const { id: realmId } = await params
  const realm = unwrapOr(await getRealm(realmId), null)
  if (!realm) notFound()

  // 当前用户角色：决定哪些区块可操作（服务端守卫兜底，前端只做呈现裁剪）
  const membersResult = await listRealmMembers({ realmId })
  const currentActorRole = membersResult.success
    ? membersResult.data.currentActorRole
    : null
  const keys = unwrapOr(await listApiKeys({ realmId }), [])
  const isOwner = currentActorRole === 'owner'

  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <div className="mx-auto max-w-2xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow="Realm Settings"
          title={realm.name}
          description="Realm 的边界与凭据：名称、成员、API Keys 与删除。"
        />

        <div className="mt-10 flex flex-col gap-6">
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
                href={`/realms/${realm.id}/members`}
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
      </div>
    </NavShell>
  )
}
