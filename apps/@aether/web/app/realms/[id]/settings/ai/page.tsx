// @aether/web · /realms/[id]/settings/ai：Realm 级 AI provider 配置（团队共享）
// NavShell / PageHeader / TabNav 由 settings/layout.tsx 提供，本页只渲染内容区。
import AiConfigPanel from '@/components/settings/ai-config-panel'
import { listRealmAiConfigs } from '@/lib/ai-config'
import { unwrapOr } from '@/lib/action-result'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function RealmAiSettingsPage({ params }: PageProps) {
  const { id: realmId } = await params
  const configs = unwrapOr(await listRealmAiConfigs({ realmId }), [])

  return (
    <div>
      <p className="text-copy-14 text-neutral-7">
        团队共享的 AI provider 凭据：Entity 运行时优先使用团队默认配置，未配置时回退到成员的个人配置。
      </p>
      <div className="mt-6">
        <AiConfigPanel configs={configs} scope="realm" realmId={realmId} />
      </div>
    </div>
  )
}
