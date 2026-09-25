// @aether/web · /realms/[id]/board 页面：Thread 看板
// 按状态四列展示，拖拽切换状态（复用 corePatchThread 状态机）。
import { listThreads } from '@/lib/threads'
import { unwrapOr } from '@/lib/action-result'
import { getRealm } from '@/lib/realms'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import ThreadBoard from '@/components/thread-board'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function BoardPage({ params }: PageProps) {
  const { id: realmId } = await params
  const [realmResult, threadsResult] = await Promise.all([
    getRealm(realmId),
    listThreads(realmId),
  ])
  const realm = unwrapOr(realmResult, null)
  if (!realm) notFound()
  const threads = unwrapOr(threadsResult, [])
  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <div className="mx-auto max-w-7xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow={realm.slug}
          title="看板"
          description={`${realm.name} 的 Thread 按状态流转，拖拽卡片切换状态。`}
        />
        <ThreadBoard realmId={realm.id} threads={threads} />
      </div>
    </NavShell>
  )
}
