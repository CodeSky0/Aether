// @aether/web · /realms/[id]/ci 页面：CI/CD 总览
// 列出 Realm 绑定 GitHub 仓库默认分支的 check runs。
import { listCiRuns } from '@/lib/ci-actions'
import { unwrapOr } from '@/lib/action-result'
import { getRealm } from '@/lib/realms'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import { CiRunsPanel } from '@/components/ci-runs-panel'
import { CiStatusBadge } from '@/components/ci-status-badge'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CiPage({ params }: PageProps) {
  const { id: realmId } = await params
  const [realmResult, ciResult] = await Promise.all([
    getRealm(realmId),
    listCiRuns(realmId),
  ])
  const realm = unwrapOr(realmResult, null)
  if (!realm) notFound()
  const runs = unwrapOr(ciResult, null)

  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <div className="mx-auto max-w-7xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow={realm.slug}
          title="CI/CD"
          description={`${realm.name} 的持续集成结果。`}
        />
        <div className="mt-8">
          {runs ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <CiStatusBadge runs={runs} />
                <span className="font-mono text-caption-10 text-neutral-5">
                  {runs.length} check runs
                </span>
              </div>
              <CiRunsPanel runs={runs} />
            </>
          ) : (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
              <p className="text-copy-13 text-neutral-7">未配置 GitHub 集成</p>
              <p className="mt-1 text-label-12 text-neutral-6">
                在 Realm 设置中绑定 GitHub 仓库后，CI 结果将显示在此。
              </p>
            </div>
          )}
        </div>
      </div>
    </NavShell>
  )
}
