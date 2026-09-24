// @aether/web · AI 配置面板（用户级 / Realm 级共用）
// 列表 + 新建/编辑表单 + 删除。API key 编辑时留空则保留原 key（仅显示前缀掩码）。
'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'
import {
  deleteUserAiConfig,
  deleteRealmAiConfig,
  upsertUserAiConfig,
  upsertRealmAiConfig,
  type AiConfigRow,
  type AiProvider,
} from '@/lib/ai-config'

interface AiConfigPanelProps {
  configs: AiConfigRow[]
  scope: 'user' | 'realm'
  realmId?: string
}

const PROVIDERS: ReadonlyArray<{ value: AiProvider; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'azure-openai', label: 'Azure OpenAI' },
  { value: 'custom', label: '自定义' },
]

interface SaveInput {
  id?: string
  provider: AiProvider
  label?: string
  apiKey?: string
  model: string
  baseUrl?: string
  isDefault: boolean
}

export default function AiConfigPanel({
  configs,
  scope,
  realmId,
}: AiConfigPanelProps) {
  const router = useRouter()
  const toast = useToast()
  const [editing, setEditing] = useState<AiConfigRow | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function handleSave(input: SaveInput): Promise<boolean> {
    const result =
      scope === 'user'
        ? await upsertUserAiConfig(input)
        : await upsertRealmAiConfig({ ...input, realmId: realmId! })
    if (!result.success) {
      toast.error(result.error)
      return false
    }
    toast.success('已保存 AI 配置')
    setShowForm(false)
    setEditing(null)
    router.refresh()
    return true
  }

  async function handleDelete(id: string) {
    const result =
      scope === 'user'
        ? await deleteUserAiConfig({ id })
        : await deleteRealmAiConfig({ id, realmId: realmId! })
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success('已删除配置')
    router.refresh()
  }

  return (
    <div>
      {configs.length === 0 && !showForm && (
        <p className="text-copy-14 text-neutral-6">尚未配置 AI provider。</p>
      )}
      <div className="mt-4 space-y-3">
        {configs.map((cfg) => {
          const providerLabel =
            PROVIDERS.find((p) => p.value === cfg.provider)?.label ??
            cfg.provider
          return (
            <div
              key={cfg.id}
              className="flex items-center justify-between rounded-md bg-neutral-2 p-3"
            >
              <div className="min-w-0">
                <p className="text-copy-14 text-neutral-9">
                  {cfg.label || providerLabel}
                  {cfg.isDefault && (
                    <span className="ml-2 text-label-12 text-accent">默认</span>
                  )}
                </p>
                <p className="truncate font-mono text-label-12 text-neutral-6">
                  {cfg.apiKeyPrefix}… · {cfg.model}
                  {cfg.baseUrl && ` · ${cfg.baseUrl}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(cfg)
                    setShowForm(true)
                  }}
                  className="btn-ghost px-3 py-1.5 text-label-12"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleDelete(cfg.id)
                  }}
                  className="btn-ghost px-3 py-1.5 text-label-12 text-error hover:text-error"
                >
                  删除
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {showForm && (
        <AiConfigForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}
      {!showForm && (
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
          className="btn-primary mt-4 px-4 py-2 text-label-12"
        >
          添加配置
        </button>
      )}
    </div>
  )
}

function AiConfigForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: AiConfigRow | null
  onSave: (input: SaveInput) => Promise<boolean>
  onCancel: () => void
}) {
  const [provider, setProvider] = useState<AiProvider>(initial?.provider ?? 'openai')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(initial?.model ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const payload: SaveInput = {
      provider,
      model,
      isDefault,
    }
    if (initial?.id) payload.id = initial.id
    if (label) payload.label = label
    if (apiKey) payload.apiKey = apiKey
    if (baseUrl) payload.baseUrl = baseUrl
    await onSave(payload)
    setSubmitting(false)
  }

  const inputClass = 'field text-copy-14'
  const labelClass = 'text-label-12 text-neutral-6'

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="mt-4 space-y-3 rounded-md bg-neutral-2 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as AiProvider)}
            className={inputClass}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>模型</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="如 gpt-4o"
            className={inputClass}
            required
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>展示名（可选）</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>
          API Key{initial ? '（留空则保留原 key）' : ''}
        </span>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder={initial ? `当前：${initial.apiKeyPrefix}…` : 'sk-…'}
          className={inputClass}
          required={!initial}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Base URL（可选）</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        <span className="text-label-12 text-neutral-7">设为默认配置</span>
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary px-4 py-2 text-label-12"
        >
          {submitting ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost px-4 py-2 text-label-12"
        >
          取消
        </button>
      </div>
    </form>
  )
}
