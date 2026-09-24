// @aether/web · /onboarding：注册后强制选择加入或创建团队
// 新用户必经：创建团队（自动成为管理员）或凭加入码申请加入（等待审批）。
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import CreateRealmForm from '@/components/create-realm-form'
import JoinTeamForm from '@/components/join-team-form'

export const dynamic = 'force-dynamic'

export default function OnboardingPage() {
  return (
    <NavShell>
      <div className="mx-auto max-w-2xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow="Onboarding"
          title="加入或创建团队"
          description="选择一个协作边界开始——创建新团队自动成为管理员，或凭加入码加入已有团队。"
        />
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="rounded-xl bg-neutral-1 p-6 ring-1 ring-border">
            <h2 className="font-serif text-title-20 text-neutral-10">
              创建团队
            </h2>
            <p className="mt-1 text-label-12 text-neutral-6">
              命名你的协作边界，你将自动成为管理员。
            </p>
            <CreateRealmForm />
          </section>
          <section className="rounded-xl bg-neutral-1 p-6 ring-1 ring-border">
            <h2 className="font-serif text-title-20 text-neutral-10">
              加入团队
            </h2>
            <p className="mt-1 text-label-12 text-neutral-6">
              输入团队加入码，提交后等待管理员审批。
            </p>
            <JoinTeamForm />
          </section>
        </div>
      </div>
    </NavShell>
  )
}
