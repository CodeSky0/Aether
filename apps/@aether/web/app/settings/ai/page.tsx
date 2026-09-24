// @aether/web · /settings/ai：用户级 AI provider 配置
// 跨团队复用；团队未配置 AI 时作为默认 fallback。
import { redirect } from 'next/navigation'

import NavShell from '@/components/nav-shell'
import PageHeader from '@/components/page-header'
import UserSettingsTabs from '@/components/settings/user-settings-tabs'
import AiConfigPanel from '@/components/settings/ai-config-panel'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { listUserAiConfigs } from '@/lib/ai-config'
import { unwrapOr } from '@/lib/action-result'

export const dynamic = 'force-dynamic'

export default async function UserAiSettingsPage() {
  const actor = await resolveCurrentActor()
  if (actor === null) redirect('/login')
  const configs = unwrapOr(await listUserAiConfigs(), [])

  return (
    <NavShell>
      <div className="mx-auto max-w-2xl px-6 py-12 md:px-8">
        <PageHeader
          eyebrow="Settings"
          title="AI 配置"
          description="你的 AI provider 凭据：跨团队复用，团队未配置时作为默认。"
        />
        <UserSettingsTabs />
        <div className="mt-6">
          <AiConfigPanel configs={configs} scope="user" />
        </div>
      </div>
    </NavShell>
  )
}
