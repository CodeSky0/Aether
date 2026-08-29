// @aether/web · 新建 Realm 表单（Client Component）
// 核心环 Step 4：用户只需命名，slug 由服务端自动生成。
// 创建成功直接落入 /realm/[id]/current——创建即进入，不多一次点击。
// Step 2：服务端失败经 Toast（suoh 左缘）反馈，不再占用内联错误位。
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRealm } from '@/lib/realms'
import { useToast } from '@/components/ui/toast'

interface CreateRealmFormProps {
  /** 创建成功回调（如关闭所在 Modal）；导航仍由本表单负责 */
  onCreated?: () => void
}

export default function CreateRealmForm({ onCreated }: CreateRealmFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      const result = await createRealm({ name: name.trim() })
      if (!result.success) {
        toast.error(
          result.error.includes('DATABASE') || result.error.includes('database')
            ? '数据库未连接。请检查 DATABASE_URL 配置后重试。'
            : result.error,
        )
        return
      }
      setName('')
      onCreated?.()
      // 创建即进入 Current（核心环 Step 5）
      router.push(`/realm/${result.data.id}/current`)
    } catch (err) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(err instanceof Error ? err.message : '创建失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e) }} className="mt-4">
      <label className="block text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        命名你的 Realm
      </label>
      <div className="mt-2 flex flex-col gap-2">
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
          {submitting ? '创建中…' : 'Create Realm'}
        </button>
      </div>
    </form>
  )
}
