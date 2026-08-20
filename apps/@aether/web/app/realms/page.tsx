// @aether/web · /realms 页面：Realm 列表与创建表单
// Yohaku：页头统一 eyebrow + serif H1；创建表单收进安静的面板，卡片以余白呼吸。
import { listRealmCards } from '@/lib/realms'
import RealmCard from '@/components/realm-card'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import CreateRealmForm from '@/components/create-realm-form'

export const dynamic = 'force-dynamic'

export default async function RealmsPage() {
  const realms = await listRealmCards()

  return (
    <NavShell>
      <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow="All Realms"
          title="Realms"
          description="Realm 是隔离的工作空间：成员、Thread 与数据边界都以 Realm 为单位。"
        />

        <section className="mb-12 rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
          <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
            新建 Realm
          </p>
          <CreateRealmForm />
        </section>

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
      <p className="text-copy-14 text-neutral-7">暂无 Realm</p>
      <p className="mt-2 text-label-12 text-neutral-6">
        在上方面板填写 slug 与名称，创建第一个工作空间。
      </p>
    </div>
  )
}
