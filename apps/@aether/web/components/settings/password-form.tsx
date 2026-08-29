// @aether/web · 修改密码表单
// Better-Auth changePassword：成功后吊销其他会话（服务端行为），本会话保持。
'use client'

import { useState } from 'react'
import { changePassword } from '@/app/actions/profile'
import { useToast } from '@/components/ui/toast'

export default function PasswordForm() {
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致。')
      return
    }
    setSubmitting(true)
    try {
      const result = await changePassword({ currentPassword, newPassword })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('密码已修改，其他设备会话已吊销。')
    } catch (err) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      toast.error(err instanceof Error ? err.message : '修改失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg bg-neutral-1 p-5 ring-1 ring-border">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        密码
      </p>
      <form
        onSubmit={(e) => { void handleSubmit(e) }}
        className="mt-4 flex flex-col gap-3"
      >
        <label className="block">
          <span className="text-label-12 text-neutral-6">当前密码</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="field mt-1 w-full"
            required
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-label-12 text-neutral-6">新密码</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              className="field mt-1 w-full"
              required
            />
          </label>
          <label className="block">
            <span className="text-label-12 text-neutral-6">确认新密码</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              className="field mt-1 w-full"
              required
            />
          </label>
        </div>
        <div>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? '修改中…' : '修改密码'}
          </button>
        </div>
      </form>
    </section>
  )
}
