// @aether/web · Danger Zone（Step 4 契约）
// 删除 Realm：键入 DELETE 确认的 Modal，suoh 强调色。
// 软删除（服务端 owner-only 守卫兜底）；成功后跳回 /realms。
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { deleteRealm } from '@/lib/realms'

interface DangerZoneProps {
  realmId: string
  realmName: string
  isOwner: boolean
}

export default function DangerZone({ realmId, realmName, isOwner }: DangerZoneProps) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const armed = confirmText === 'DELETE'

  async function handleDelete() {
    if (!armed) return
    setDeleting(true)
    try {
      const result = await deleteRealm({ realmId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Realm「${realmName}」已删除。`)
      router.push('/realms')
      router.refresh()
    } catch (err) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(err instanceof Error ? err.message : '删除失败，请稍后重试。')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="rounded-lg p-5 ring-1 ring-error/40">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-error">
        Danger Zone
      </p>
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-copy-14 text-neutral-7">
          删除此 Realm 及其全部 Thread。此操作可恢复窗口由数据库保留策略决定。
        </p>
        {isOwner ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true)
              setConfirmText('')
            }}
            className="btn-ghost shrink-0 border-error/40 text-error hover:text-error"
          >
            删除 Realm
          </button>
        ) : (
          <span className="shrink-0 text-label-12 text-neutral-6">
            仅 owner 可删除
          </span>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`删除 ${realmName}`}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setOpen(false)}
              disabled={deleting}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary border-error bg-error text-neutral-1 hover:bg-error"
              disabled={!armed || deleting}
              onClick={() => { void handleDelete() }}
            >
              {deleting ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p className="text-copy-14 text-neutral-7">
          此操作将软删除 Realm「{realmName}」与其全部 Thread。成员、Entity
          与审计记录将保留但不可访问。
        </p>
        <p className="mt-4 text-label-12 text-neutral-6">
          键入 <span className="font-mono text-error">DELETE</span> 以确认：
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="field mt-2 w-full font-mono"
          autoFocus
        />
      </Modal>
    </section>
  )
}
