// @aether/web · /realm/[id]/current：核心环 Step 5 的落点
// 服务端聚合 Realm / Threads / 主体 / 默认 Project，渲染三栏 Current 工作区。
// 不做任何与核心环无关的模块：进入即编辑，编辑即协同，刷新即恢复。
import { notFound } from 'next/navigation'

import CurrentWorkspace from '@/components/current-workspace'
import NavShell from '@/components/nav-shell'
import { listRealmActors } from '@/lib/entities'
import { ensureDefaultProject, getRealm } from '@/lib/realms'
import { listThreads } from '@/lib/threads'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CurrentPage({ params }: PageProps) {
  const { id: realmId } = await params
  const realm = await getRealm(realmId)
  if (!realm) notFound()

  const [threads, actors, defaultProjectId] = await Promise.all([
    listThreads(realmId),
    listRealmActors(realmId),
    ensureDefaultProject(realmId),
  ])

  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <CurrentWorkspace
        realmId={realm.id}
        realmName={realm.name}
        threads={threads}
        actors={actors}
        defaultProjectId={defaultProjectId}
      />
    </NavShell>
  )
}
