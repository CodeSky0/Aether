// @aether/web · /realms/[id] → /realm/[id]/current
// 核心环收敛：Realm 详情已整合进 Current 工作区（底部 Threads 面板），
// 旧路由一律重定向，保证单一、清晰的用户旅程。
import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function RealmPage({ params }: PageProps) {
  const { id } = await params
  redirect(`/realm/${id}/current`)
}
