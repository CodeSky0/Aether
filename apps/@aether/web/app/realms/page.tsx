// @aether/web · /realms 页面：Realm 列表与创建入口（Modal）
// Yohaku：页头统一 eyebrow + serif H1；创建走 Modal，卡片以余白呼吸。
import { listRealmCards } from '@/lib/realms'
import { unwrapOr } from '@/lib/action-result'
import RealmCard from '@/components/realm-card'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import CreateRealmModal from '@/components/create-realm-modal'

export const dynamic = 'force-dynamic'

export default async function RealmsPage() {
  const realms = unwrapOr(await listRealmCards(), [])

  return (
    <NavShell>
      <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            eyebrow="All Realms"
            title="Realms"
            description="Realm 是隔离的协作边界：成员、Thread 与数据边界都以 Realm 为单位。"
          />
          <div className="pt-8">
            <CreateRealmModal />
          </div>
        </div>

        {realms.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {realms.map((r) => (
              <RealmCard key={r.id} realm={r} />
            ))}
          </div>
        )}
      </div>
    </NavShell>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-neutral-1 px-6 py-16 text-center">
      <p className="font-serif text-copy-16 text-neutral-7">The void awaits.</p>
      <p className="mt-2 text-label-12 text-neutral-6">
        创建你的第一个 Realm，划定协作边界。
      </p>
      <div className="mt-6">
        <CreateRealmModal label="Create First Realm" />
      </div>
    </div>
  )
}
