// @aether/web · GitHub Resonance 集成卡片
// Yohaku 契约（Phase Shift Step 5）：
//   卡片：bg-neutral-1 ring-1 ring-border rounded-xl p-6
//   Connected：若竹 wakatake 点（border-l-success / text-success）
//   Disconnected：neutral-5 点
//   Connect 按钮：bg-neutral-9 text-neutral-1（spec 指定，非 accent）
//   Manage 按钮：ring-1 ring-border（btn-ghost）
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { disconnectIntegration } from '@/app/actions/integrations'
import type { RealmIntegrationRow } from '@/lib/integrations'
import { useToast } from '@/components/ui/toast'

interface GithubIntegrationCardProps {
  realmId: string
  integration: RealmIntegrationRow | null
  canManage: boolean
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33s1.7.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0 0 22 12c0-5.52-4.48-10-10-10Z" />
    </svg>
  )
}

export default function GithubIntegrationCard({
  realmId,
  integration,
  canManage,
}: GithubIntegrationCardProps) {
  const router = useRouter()
  const toast = useToast()
  const [disconnecting, setDisconnecting] = useState(false)

  const connected = integration !== null && integration.status === 'active'
  const installUrl = `/api/auth/github/install?realmId=${encodeURIComponent(realmId)}`

  async function handleDisconnect() {
    if (!integration) return
    setDisconnecting(true)
    try {
      const result = await disconnectIntegration({
        realmId,
        integrationId: integration.id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('已断开 GitHub 连接')
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '断开失败，请稍后重试。')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section className="rounded-xl bg-neutral-1 p-6 ring-1 ring-border">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <GithubMark className="h-6 w-6 text-neutral-8" />
          <div>
            <h3 className="font-serif text-title-20 text-neutral-10">GitHub</h3>
            <p className="mt-0.5 text-copy-14 text-neutral-7">
              Issue ↔ Thread · PR ↔ Manifestation 双向共振
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-success' : 'bg-neutral-5'}`}
            aria-hidden="true"
          />
          <span
            className={`text-label-12 ${connected ? 'text-success' : 'text-neutral-5'}`}
          >
            {connected ? '已连接' : '未连接'}
          </span>
        </div>
      </div>

      {connected && integration && (
        <div className="mt-4 rounded-lg bg-neutral-2 p-3">
          <p className="text-label-12 text-neutral-6">Installation</p>
          <p className="mt-1 font-mono text-label-12 text-neutral-8">
            #{integration.installation_id}
            {integration.repo_full_name && ` · ${integration.repo_full_name}`}
          </p>
        </div>
      )}

      {canManage && (
        <div className="mt-5 flex items-center gap-2">
          {connected ? (
            <>
              <a
                href={`https://github.com/settings/installations`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
              >
                管理
              </a>
              <button
                type="button"
                disabled={disconnecting}
                onClick={() => { void handleDisconnect() }}
                className="btn-ghost text-error hover:text-error"
              >
                {disconnecting ? '断开中…' : '断开连接'}
              </button>
            </>
          ) : (
            <a
              href={installUrl}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-neutral-9 px-4 py-2 text-copy-14 font-medium text-neutral-1 transition hover:bg-neutral-8"
            >
              连接 GitHub
            </a>
          )}
        </div>
      )}
    </section>
  )
}
