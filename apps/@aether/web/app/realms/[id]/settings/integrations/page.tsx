// @aether/web · /realms/[id]/settings/integrations：Resonance 集成设置
// NavShell / PageHeader / TabNav 由 settings/layout.tsx 提供。
// GitHub OAuth callback 重定向到此页并带 ?github=connected|disconnected 状态标记。
import GithubIntegrationCard from '@/components/settings/github-integration-card'
import { listRealmIntegrations } from '@/lib/integrations'
import { listRealmMembers } from '@/app/actions/membership'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ github?: string }>
}

export default async function IntegrationsSettingsPage({
  params,
  searchParams,
}: PageProps) {
  const [{ id: realmId }, query] = await Promise.all([params, searchParams])

  const [integrations, membersResult] = await Promise.all([
    listRealmIntegrations(realmId),
    listRealmMembers({ realmId }),
  ])
  const currentActorRole = membersResult.success
    ? membersResult.data.currentActorRole
    : null
  const canManage = currentActorRole === 'owner' || currentActorRole === 'admin'

  const githubIntegration =
    integrations.find((row) => row.provider === 'github') ?? null

  const flash =
    query.github === 'connected'
      ? 'GitHub 已成功连接。'
      : query.github === 'disconnected'
        ? 'GitHub 连接已断开。'
        : null

  return (
    <div className="space-y-4">
      {flash && (
        <div className="rounded-lg border border-border bg-neutral-2 p-4 text-copy-14 text-neutral-8">
          {flash}
        </div>
      )}

      <GithubIntegrationCard
        realmId={realmId}
        integration={githubIntegration}
        canManage={canManage}
      />

      <section className="rounded-xl bg-neutral-1 p-6 ring-1 ring-border">
        <div className="flex items-center gap-3">
          <span className="font-serif text-title-20 text-neutral-6">GitLab</span>
          <span className="text-label-12 text-neutral-5">即将支持</span>
        </div>
        <p className="mt-1 text-copy-14 text-neutral-6">
          MR ↔ Manifestation、Issue ↔ Thread 映射。
        </p>
      </section>

      <section className="rounded-xl bg-neutral-1 p-6 ring-1 ring-border">
        <div className="flex items-center gap-3">
          <span className="font-serif text-title-20 text-neutral-6">Linear</span>
          <span className="text-label-12 text-neutral-5">即将支持</span>
        </div>
        <p className="mt-1 text-copy-14 text-neutral-6">
          Linear Issue ↔ Thread 双向同步。
        </p>
      </section>
    </div>
  )
}
