// @aether/auth · 会话主体解析
// 浏览器会话只代表 human；Entity 主体由 Entity runtime 注入，不经过此链路。
import type { AuthInstance } from './instance.js'

export interface SessionActor {
  actorType: 'human'
  actorId: string
  /** Better-Auth session.activeOrganizationId，即当前 Realm；无则为 null。 */
  activeRealmId: string | null
}

/**
 * 经 Better-Auth getSession 解析当前请求主体。
 * 无有效会话时返回 null，headers 原样透传以保留 cookie / authorization。
 */
export async function resolveSessionActor(
  auth: AuthInstance,
  headers: Headers,
): Promise<SessionActor | null> {
  const result = await auth.api.getSession({ headers })
  if (!result) return null

  return {
    actorType: 'human',
    actorId: result.user.id,
    activeRealmId: result.session.activeOrganizationId ?? null,
  }
}
