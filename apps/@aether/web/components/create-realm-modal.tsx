// @aether/web · 新建 Realm 入口（Modal 触发器）
// Step 2 契约：Create Realm 走 Modal（backdrop n-10/50 + blur，容器 n-1 + ring + whisper）。
// 创建成功由 CreateRealmForm 内部导航到 Current，此处无需额外善后。
'use client'

import { useState } from 'react'
import Modal from '@/components/ui/modal'
import CreateRealmForm from '@/components/create-realm-form'

interface CreateRealmModalProps {
  /** 触发按钮文案；默认「新建 Realm」 */
  label?: string
  /** 空态下使用主按钮形态（页面上唯一的行动出口） */
  variant?: 'primary' | 'ghost'
}

export default function CreateRealmModal({
  label = '新建 Realm',
  variant = 'primary',
}: CreateRealmModalProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={variant === 'primary' ? 'btn-primary' : 'btn-ghost'}
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="新建 Realm">
        <p className="text-copy-14 text-neutral-7">
          为 Realm 命名，slug 由服务端自动生成。
        </p>
        <CreateRealmForm onCreated={() => setOpen(false)} />
      </Modal>
    </>
  )
}
