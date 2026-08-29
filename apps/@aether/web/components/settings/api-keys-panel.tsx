// @aether/web · API Keys 面板（Resonance 预备）
// 明文密钥仅生成后当场展示一次（font-mono bg-neutral-2 p-2 rounded 契约），
// 刷新即不可再现；吊销后从列表消失。
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  generateApiKey,
  revokeApiKey,
  type ApiKeyRow,
} from '@/lib/api-keys'
import { useToast } from '@/components/ui/toast'

interface ApiKeysPanelProps {
  realmId: string
  initialKeys: ApiKeyRow[]
  canManage: boolean
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(
    new Date(value),
  )
}

export default function ApiKeysPanel({
  realmId,
  initialKeys,
  canManage,
}: ApiKeysPanelProps) {
  const router = useRouter()
  const toast = useToast()
  const [keys, setKeys] = useState<ApiKeyRow[]>(initialKeys)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  /** 刚生成的明文：仅展示一次，任何导航/刷新即消失 */
  const [freshPlaintext, setFreshPlaintext] = useState<string | null>(null)

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      const result = await generateApiKey({ realmId, name: name.trim() })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setKeys((prev) => [
        {
          id: result.data.id,
          name: result.data.name,
          key_prefix: result.data.key_prefix,
          created_at: result.data.created_at,
          last_used_at: result.data.last_used_at,
        },
        ...prev,
      ])
      setFreshPlaintext(result.data.plaintext)
      setName('')
      toast.success('密钥已生成——请立即复制，它不会再次展示。')
    } catch (err) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(err instanceof Error ? err.message : '生成失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(keyId: string) {
    setRevokingId(keyId)
    try {
      const result = await revokeApiKey({ realmId, keyId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setKeys((prev) => prev.filter((key) => key.id !== keyId))
      toast.success('密钥已吊销')
      router.refresh()
    } catch (err) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(err instanceof Error ? err.message : '吊销失败，请稍后重试。')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        API Keys · Resonance 预备
      </p>
      <p className="mt-2 text-copy-14 text-neutral-7">
        外部插件与工具访问此 Realm 的凭据。明文只展示一次，库内仅存哈希。
      </p>

      {canManage && (
        <form
          onSubmit={(e) => { void handleGenerate(e) }}
          className="mt-4 flex items-center gap-3"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="密钥名称（如 VS Code 插件）"
            className="field flex-1"
            required
          />
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? '生成中…' : '生成'}
          </button>
        </form>
      )}

      {freshPlaintext && (
        <div className="mt-4 rounded-lg border border-dashed border-border p-3">
          <p className="text-label-12 text-neutral-6">
            复制此密钥——关闭后将无法再次查看：
          </p>
          <code className="mt-2 block break-all rounded bg-neutral-2 p-2 font-mono text-label-12 text-neutral-9">
            {freshPlaintext}
          </code>
          <button
            type="button"
            className="btn-ghost mt-2"
            onClick={() => {
              void navigator.clipboard?.writeText(freshPlaintext).then(() => {
                toast.info('密钥已复制到剪贴板')
              })
            }}
          >
            复制
          </button>
        </div>
      )}

      <div className="mt-4">
        {keys.length === 0 ? (
          <p className="py-6 text-center text-copy-14 text-neutral-6">
            {canManage
              ? '尚无密钥。为你的第一个插件生成一把。'
              : '尚无密钥。'}
          </p>
        ) : (
          <ul>
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex items-center gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-copy-14 text-neutral-9">{key.name}</p>
                  <p className="font-mono text-label-12 text-neutral-6">
                    {key.key_prefix}… · 创建于 {formatDate(key.created_at)}
                    {key.last_used_at &&
                      ` · 最近使用 ${formatDate(key.last_used_at)}`}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    disabled={revokingId === key.id}
                    onClick={() => { void handleRevoke(key.id) }}
                    className="btn-ghost shrink-0 text-error hover:text-error"
                  >
                    {revokingId === key.id ? '吊销中…' : '吊销'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
