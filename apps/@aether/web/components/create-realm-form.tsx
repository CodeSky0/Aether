// @aether/web · 新建 Realm 表单（Client Component）
// 核心环 Step 4：用户只需命名，slug 由服务端自动生成。
// 创建成功直接落入 /realm/[id]/current——创建即进入，不多一次点击。
// Yohaku：.field 统一控件形态，主按钮是大号 CTA（空态下是页面上唯一的行动出口）。
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRealm } from '@/lib/realms'

export default function CreateRealmForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createRealm({ name: name.trim() })
      setName('')
      // 创建即进入 Current（核心环 Step 5）
      router.push(`/realm/${result.id}/current`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e) }} className="mt-4">
      <label className="block text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        命名你的 Realm
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：My First Current"
          className="field flex-1 text-copy-16"
          autoFocus
          required
        />
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary px-6 py-2.5 text-copy-16"
        >
          {submitting ? '创建中…' : 'Create First Realm'}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-label-12 text-error">
          {error.includes('DATABASE') || error.includes('database')
            ? '数据库未连接。请检查 DATABASE_URL 配置后重试。'
            : error}
        </p>
      )}
    </form>
  )
}
