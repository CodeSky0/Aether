// @aether/web · /realms/[id]/prs/[number] 页面：PR 评审
// 聚合 PR diff + reviews + comments，支持 approve / request changes / merge。
import { getPRDetail } from '@/lib/pr-actions'
import { unwrapOr } from '@/lib/action-result'
import { getRealm } from '@/lib/realms'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import { PrDiffViewer } from '@/components/pr-diff-viewer'
import { PrReviewPanel } from '@/components/pr-review-panel'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string; number: string }>
}

export default async function PrPage({ params }: PageProps) {
  const { id: realmId, number: prNumberStr } = await params
  const prNumber = parseInt(prNumberStr, 10)
  if (Number.isNaN(prNumber)) notFound()

  const [realmResult, prResult] = await Promise.all([
    getRealm(realmId),
    getPRDetail(realmId, prNumber),
  ])
  const realm = unwrapOr(realmResult, null)
  if (!realm) notFound()
  const prDetail = unwrapOr(prResult, null)
  if (!prDetail) notFound()

  return (
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <div className="mx-auto max-w-7xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow={`PR #${prDetail.pr.number}`}
          title={prDetail.pr.title}
          description={`${prDetail.pr.author} · ${prDetail.pr.state}${prDetail.pr.draft ? ' · draft' : ''}`}
        />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <p className="shrink-0 pb-2 text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
              Diff（{prDetail.files.length} 文件）
            </p>
            <PrDiffViewer files={prDetail.files} />
          </div>
          <div>
            <PrReviewPanel
              realmId={realm.id}
              prNumber={prDetail.pr.number}
              prState={prDetail.pr.state}
              reviews={prDetail.reviews}
              comments={prDetail.comments}
            />
          </div>
        </div>
      </div>
    </NavShell>
  )
}
