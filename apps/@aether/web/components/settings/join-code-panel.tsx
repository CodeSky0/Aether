// @aether/web · 团队加入码面板（General tab 内）
// 显示当前加入码（可隐藏/显示），owner/admin 可生成/轮换。
'use client'
import { useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { ensureJoinCode, rotateJoinCode } from '@/lib/team-join'

interface JoinCodePanelProps {
  realmId: string
  initialCode: string | null
  canManage: boolean
}

export default function JoinCodePanel({
  realmId,
  initialCode,
  canManage,
}: JoinCodePanelProps) {
  const toast = useToast()
  const [code, setCode] = useState(initialCode)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)

  async function handleGenerate() {
    setBusy(true)
    try {
      const result = await ensureJoinCode({ realmId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setCode(result.data.code)
      setRevealed(true)
      toast.success('已生成加入码')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleRotate() {
    setBusy(true)
    try {
      const result = await rotateJoinCode({ realmId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setCode(result.data.code)
      setRevealed(true)
      toast.success('加入码已轮换，旧码失效')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '轮换失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        团队加入码
      </p>
      <p className="mt-2 text-copy-14 text-neutral-7">
        分享此码给需要加入的成员，他们凭码提交申请后由管理员审批。
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {code ? (
          <>
            <code className="rounded-md bg-neutral-2 px-3 py-2 font-mono text-copy-16 tracking-widest text-neutral-10">
              {revealed ? code : '••••••••'}
            </code>
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="btn-ghost px-3 py-2 text-label-12"
            >
              {revealed ? '隐藏' : '显示'}
            </button>
            {canManage && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void handleRotate()
                }}
                className="btn-ghost px-3 py-2 text-label-12"
              >
                {busy ? '…' : '轮换'}
              </button>
            )}
          </>
        ) : canManage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void handleGenerate()
            }}
            className="btn-primary px-4 py-2 text-label-12"
          >
            {busy ? '…' : '生成加入码'}
          </button>
        ) : (
          <p className="text-label-12 text-neutral-6">尚未生成加入码</p>
        )}
      </div>
    </section>
  )
}
