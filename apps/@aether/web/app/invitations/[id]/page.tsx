// @aether/web · /invitations/[id] 页面：接受 Realm 邀请
// 邮件链接只携带 invitationId，身份与 Realm 归属由服务端 action 校验。
import AcceptRealmInvitation from '@/components/accept-realm-invitation'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InvitationPage({ params }: PageProps) {
  const { id: invitationId } = await params
  return <AcceptRealmInvitation invitationId={invitationId} />
}
