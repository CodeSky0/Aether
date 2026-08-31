// @aether/web · /realms/[id]/members → /realms/[id]/settings/members
// 成员管理已纳入 Settings Tab 布局；旧路由重定向保持链接兼容。
import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function MembersPage({ params }: PageProps) {
  const { id } = await params
  redirect(`/realms/${id}/settings/members`)
}
