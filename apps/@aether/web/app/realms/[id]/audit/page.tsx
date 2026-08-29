// @aether/web · /realms/[id]/audit 页面：审计记录列表
// Yohaku：eyebrow 承载 slug，记录列表以 hairline 分隔呈现台账质感。
import { listAuditLogs } from '@/lib/audit'
import { unwrapOr } from '@/lib/action-result'
import { listRealms } from '@/lib/realms'
import AuditLogList from '@/components/audit-log-list'
import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import { notFound } from 'next/navigation'
export const dynamic = 'force-dynamic'
const INITIAL_PAGE_SIZE = 50
interface PageProps {
  params: Promise<{ id: string }>
}
export default async function AuditPage({ params }: PageProps) {
  const { id: realmId } = await params
  const [logsResult, realmsResult] = await Promise.all([
    // P1-7 修复：初始只取一页，后续由客户端"加载更多"
    listAuditLogs({ realmId, limit: INITIAL_PAGE_SIZE }),
    listRealms(),
  ])
  const logs = unwrapOr(logsResult, [])
  const realms = unwrapOr(realmsResult, [])
  const realm = realms.find((r) => r.id === realmId)
  if (!realm) notFound()
  return (
    // P1-4 修复：传入 currentRealmId，使 Sidebar 在审计页也能渲染
    <NavShell currentRealmName={realm.name} currentRealmId={realm.id}>
      <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow={realm.slug}
          title="Audit Vault"
          description={`${realm.name} 的全部操作审计记录（人 + Entity）。`}
        />
        <AuditLogList realmId={realmId} initialLogs={logs} />
      </div>
    </NavShell>
  )
}
