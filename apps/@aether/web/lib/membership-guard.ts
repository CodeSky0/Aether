// @aether/web · Realm 成员角色守卫
// 与 requireEntitlement 不同：本守卫不受 AETHER_ENTITLEMENT_ENABLED 影响，
// membership 管理端点的授权不能被功能开关关掉（否则任一已登录用户可操作任意 Realm）。
import { members, realmGuard } from '@aether/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { ensureRealmMembership } from '@/lib/membership-provisioning'
import type { CurrentActor } from '@/lib/auth-guard'

export type RealmMembershipRole = 'owner' | 'admin' | 'member'

export const MANAGE_MEMBER_ROLES: readonly RealmMembershipRole[] = [
  'owner',
  'admin',
]
export const READ_MEMBER_ROLES: readonly RealmMembershipRole[] = [
  'owner',
  'admin',
  'member',
]

/** 拒绝文案前缀：页面据此把授权失败与内部错误区分开。 */
export const MEMBERSHIP_DENIED_MESSAGE_PREFIX =
  'Realm membership does not permit this operation'

/**
 * 校验 actor 在该 Realm 持有 Realm 级 active membership 且角色在允许集合内。
 * 先做一次 JIT 镜像，让 Better-Auth organization 成员首次访问也能通过。
 * @returns 命中的角色
 * @throws Error 无 membership 或角色不足时
 */
export async function requireRealmRole(
  realmId: string,
  actor: CurrentActor,
  allowedRoles: readonly string[],
): Promise<string> {
  await ensureRealmMembership({
    realmId,
    actorType: actor.actorType,
    actorId: actor.actorId,
  })
  const [membership] = await getDb()
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        realmGuard(members, realmId),
        isNull(members.project_id),
        eq(members.actor_type, actor.actorType),
        eq(members.actor_id, actor.actorId),
        eq(members.status, 'active'),
      ),
    )
    .limit(1)

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new Error(
      `${MEMBERSHIP_DENIED_MESSAGE_PREFIX}: an active Realm membership with a sufficient role is required`,
    )
  }
  return membership.role
}
