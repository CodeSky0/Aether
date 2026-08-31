// @aether/web · /realms/[id]/settings/* 共享布局
// 渲染 NavShell + PageHeader + SettingsTabNav，子页面只负责内容区。
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import SettingsTabNav from '@/components/settings/settings-tab-nav'
import { unwrapOr } from '@/lib/action-result'
import { getRealm } from '@/lib/realms'

export const dynamic = 'force-dynamic'

interface LayoutProps {
  params: Promise<{ id: string }>
  children: ReactNode
}

export default async function RealmSettingsLayout({
  params,
  children,
}: LayoutProps) {
  const { id: realmId } = await params
  const realm = unwrapOr(await getRealm(realmId), null)
  if (!realm) notFound()

  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow="Realm Settings"
          title={realm.name}
          description="Realm 的边界与凭据：通用、成员、集成。"
        />
        <div className="mt-10 flex gap-8">
          <SettingsTabNav realmId={realm.id} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </NavShell>
  )
}
