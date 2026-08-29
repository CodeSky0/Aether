// @aether/web · Realm 邀请接受交互
// 接受结果由服务端 action 绑定到当前会话与 Realm，客户端只负责反馈和跳转。
'use client'

import { acceptRealmInvitation } from '@/app/actions/membership'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface AcceptRealmInvitationProps {
  invitationId: string
}

export default function AcceptRealmInvitation({
  invitationId,
}: AcceptRealmInvitationProps) {
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setAccepting(true)
    setError(null)
    try {
      const result = await acceptRealmInvitation({ invitationId })
      if (!result.success) {
        setError(result.error)
        setAccepting(false)
        return
      }
      router.push(`/realms/${result.data.realmId}`)
    } catch (caught) {
      // 网络层异常兜底；业务错误已由 ActionResult 承载
      setError(caught instanceof Error ? caught.message : '接受邀请失败')
      setAccepting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        Realm Invitation
      </p>
      <h1 className="mt-2 font-serif text-title-28 font-medium text-neutral-10">
        接受 Realm 邀请
      </h1>
      <p className="mt-3 text-copy-14 text-neutral-7">
        接受后，你会被加入对应 Realm，并获得邀请中指定的角色。
      </p>
      {error && (
        <div className="mt-6 rounded-md bg-error/10 p-4 text-label-12 text-error">
          <p>{error}</p>
          <Link href="/" className="mt-2 inline-block underline">
            去登录或返回首页
          </Link>
        </div>
      )}
      {!error && (
        <button
          type="button"
          className="btn-primary mt-6"
          disabled={accepting}
          onClick={() => {
            void accept()
          }}
        >
          {accepting ? '接受中…' : '接受邀请'}
        </button>
      )}
    </div>
  )
}
