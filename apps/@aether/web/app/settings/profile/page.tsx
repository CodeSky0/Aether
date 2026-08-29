// @aether/web · /settings/profile：账户设置（Step 4）
// Better-Auth 集成：改名/邮箱、修改密码。auth 未配置或未登录时给引导态，不空白。
import Link from 'next/link'

import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import ProfileForm from '@/components/settings/profile-form'
import PasswordForm from '@/components/settings/password-form'
import { getProfileSession } from '@/app/actions/profile'

export const dynamic = 'force-dynamic'

export default async function ProfileSettingsPage() {
  const session = await getProfileSession()

  return (
    <NavShell>
      <div className="mx-auto max-w-2xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow="Settings"
          title="Profile"
          description="你的 Aether 身份：名称将展示给 Realm 内的人类与 Entity。"
        />

        {session === null ? (
          <EmptyState />
        ) : (
          <div className="mt-10 flex flex-col gap-6">
            <ProfileForm initialName={session.name} initialEmail={session.email} />
            <PasswordForm />
          </div>
        )}
      </div>
    </NavShell>
  )
}

function EmptyState() {
  return (
    <section className="mt-10 rounded-xl bg-neutral-1 px-6 py-16 text-center ring-1 ring-border">
      <p className="font-serif text-title-20 text-neutral-7">
        You are alone here.
      </p>
      <p className="mt-2 text-label-12 text-neutral-6">
        登录后才能管理你的身份与密码。
      </p>
      <Link href="/login" className="btn-primary mt-6 inline-block px-6 py-2.5">
        前往登录
      </Link>
    </section>
  )
}
