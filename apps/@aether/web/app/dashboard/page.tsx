// @aether/web · /dashboard：登录后的落点（Yohaku V0.1）
// 不做通用 SaaS 仪表盘：serif「Realms」承担层级，卡片以 ring 呼吸，
// 梅红只出现在 Entity 脉冲点与 hover；空态以「虚空」收束，创建即破题。
import { listRealmCards } from '@/lib/realms'
import RealmCard from '@/components/realm-card'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import CreateRealmForm from '@/components/create-realm-form'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const realms = await listRealmCards()

  return (
    <NavShell>
      <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow="Dashboard"
          title="Realms"
          description="你所在的协作边界。选择一个 Realm 进入 Current，与人类和 Entity 共处同一状态流。"
        />

        {realms.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {realms.map((realm) => (
              <RealmCard key={realm.id} realm={realm} />
            ))}
          </div>
        )}
      </div>
    </NavShell>
  )
}

function EmptyState() {
  return (
    <section className="rounded-xl bg-neutral-1 px-6 py-16 text-center ring-1 ring-border">
      <p className="font-serif text-title-20 text-neutral-7">
        The void awaits. Create a Realm.
      </p>
      <p className="mt-2 text-label-12 text-neutral-6">
        命名你的第一个协作边界——人类与 Entity 将在此共处同一 Current。
      </p>
      <div className="mx-auto mt-8 max-w-md text-left">
        <CreateRealmForm />
      </div>
    </section>
  )
}
