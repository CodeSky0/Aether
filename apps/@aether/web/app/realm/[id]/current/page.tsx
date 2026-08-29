// @aether/web · /realm/[id]/current：核心环 Step 5 的落点
// 服务端聚合 Realm / Threads / 主体 / 默认 Project，渲染三栏 Current 工作区。
// 不做任何与核心环无关的模块：进入即编辑，编辑即协同，刷新即恢复。
import { notFound } from 'next/navigation'

import CurrentWorkspace from '@/components/current-workspace'
import NavShell from '@/components/nav-shell'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { unwrap, unwrapOr } from '@/lib/action-result'
import { listAuditLogs } from '@/lib/audit'
import { listRealmActors } from '@/lib/entities'
import { ensureDefaultProject, getRealm } from '@/lib/realms'
import { listThreads } from '@/lib/threads'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CurrentPage({ params }: PageProps) {
  const { id: realmId } = await params
  const realm = unwrapOr(await getRealm(realmId), null)
  if (!realm) notFound()

  // 获取当前会话的 Actor 信息，用于传递给编辑器（跨域跳转所需）
  const currentActor = await resolveCurrentActor()

  const [threadsResult, actorsResult, auditResult, defaultProjectResult] =
    await Promise.all([
      listThreads(realmId),
      listRealmActors(realmId),
      // Entity 活动台账（右侧「活动」Tab）+ handoff 派生的数据源
      listAuditLogs({ realmId, actorType: 'entity', limit: 50 }),
      ensureDefaultProject(realmId),
    ])
  const threads = unwrapOr(threadsResult, [])
  const actors = unwrapOr(actorsResult, [])
  const entityAuditRows = unwrapOr(auditResult, [])
  const defaultProjectId = unwrap(defaultProjectResult)

  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <CurrentWorkspace
        realmId={realm.id}
        realmName={realm.name}
        threads={threads}
        actors={actors}
        entityAuditRows={entityAuditRows}
        defaultProjectId={defaultProjectId}
        // 传递当前用户信息，用于构建编辑器 iframe URL
        currentActorId={currentActor?.actorId ?? 'anonymous'}
        currentActorName={actors.find(a => a.id === currentActor?.actorId)?.name ?? 'Guest'}
      />
    </NavShell>
  )
}
