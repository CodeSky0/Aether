// @aether/web · Realm 改名表单（Step 4）
// 无权者（member）只读展示名称；服务端守卫兜底。
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { renameRealm } from '@/lib/realms'
import { useToast } from '@/components/ui/toast'

interface RenameRealmFormProps {
  realmId: string
  initialName: string
  canRename: boolean
}

export default function RenameRealmForm({
  realmId,
  initialName,
  canRename,
}: RenameRealmFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const result = await renameRealm({ realmId, name: name.trim() })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Realm 已更名')
      router.refresh()
    } catch (err) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(err instanceof Error ? err.message : '更名失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        名称
      </p>
      {canRename ? (
        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          className="mt-4 flex items-center gap-3"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field flex-1 font-serif text-copy-16"
            required
          />
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? '保存中…' : '保存'}
          </button>
        </form>
      ) : (
        <>
          <p className="mt-3 font-serif text-copy-16 text-neutral-9">{name}</p>
          <p className="mt-1 text-label-12 text-neutral-6">
            更名需要 owner 或 admin 角色。
          </p>
        </>
      )}
    </section>
  )
}
