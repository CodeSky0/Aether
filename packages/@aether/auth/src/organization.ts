// @aether/auth · Better-Auth organization 操作薄封装
// 下游经本模块调用 organization API，不直接依赖 Better-Auth。
import type { AuthInstance } from './instance.js'
import { and, eq } from 'drizzle-orm'
import { member, user } from './schema.js'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { TablesRelationalConfig } from 'drizzle-orm'
import type { realmRoles } from './permissions.js'

export type RealmOrganizationRole = keyof typeof realmRoles

export function isPlaceholderOrganization(organizationId: string): boolean {
  return organizationId.startsWith('org-placeholder-')
}

export interface CreateRealmOrganizationInput {
  name: string
  slug: string
  ownerUserId: string
}

export function createRealmOrganization(
  auth: AuthInstance,
  input: CreateRealmOrganizationInput,
) {
  return auth.api.createOrganization({
    body: {
      name: input.name,
      slug: input.slug,
      userId: input.ownerUserId,
    },
  })
}

export interface OrganizationMemberRolesInput {
  organizationId: string
  userId: string
}

export async function findOrganizationMemberRoles<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  input: OrganizationMemberRolesInput,
): Promise<string[]> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    )

  return rows.flatMap((row) =>
    row.role
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role.length > 0),
  )
}

export async function findOrganizationMemberId<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  input: OrganizationMemberRolesInput,
): Promise<string | null> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    )
    .limit(1)
  return row?.id ?? null
}

export interface ProvisionOrganizationMemberInput {
  organizationId: string
  userId: string
  role: RealmOrganizationRole
}

/**
 * 无会话添加 organization 成员（system action：body 带 userId，不传 headers）。
 * SCIM provisioning 等服务器到服务器调用专用；已在成员表时抛 Better-Auth 错误。
 */
export function provisionOrganizationMember(
  auth: AuthInstance,
  input: ProvisionOrganizationMemberInput,
) {
  return auth.api.addMember({
    body: {
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
    },
  })
}

/**
 * 无会话移除 organization 成员（直删 member 行）。
 * 返回是否实际删除（幂等：不存在时 false）。
 */
export async function deleteOrganizationMember(
  db: Parameters<typeof findOrganizationMemberRoles>[0],
  input: OrganizationMemberRolesInput,
): Promise<boolean> {
  const deleted = await db
    .delete(member)
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    )
    .returning({ id: member.id })
  return deleted.length > 0
}

export interface OrganizationMemberUser {
  userId: string
  role: string
  name: string
  email: string
  createdAt: Date
}

/** 列出 organization 成员（联 user 表；孤儿 member 行被 inner join 自然丢弃）。 */
export async function listOrganizationMembers(
  db: Parameters<typeof findOrganizationMemberRoles>[0],
  input: { organizationId: string },
): Promise<OrganizationMemberUser[]> {
  const rows = await db
    .select({
      userId: member.userId,
      role: member.role,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, input.organizationId))
  return rows
}

export function inviteToOrganization(
  auth: AuthInstance,
  headers: Headers,
  input: {
    organizationId: string
    email: string
    role: RealmOrganizationRole
  },
) {
  return auth.api.createInvitation({
    headers,
    body: {
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
    },
  })
}

export function listOrganizationInvitations(
  auth: AuthInstance,
  headers: Headers,
  input: { organizationId: string },
) {
  return auth.api.listInvitations({
    headers,
    query: {
      organizationId: input.organizationId,
    },
  })
}

export function cancelOrganizationInvitation(
  auth: AuthInstance,
  headers: Headers,
  input: { invitationId: string },
) {
  return auth.api.cancelInvitation({
    headers,
    body: {
      invitationId: input.invitationId,
    },
  })
}

export function acceptOrganizationInvitation(
  auth: AuthInstance,
  headers: Headers,
  input: { invitationId: string },
) {
  return auth.api.acceptInvitation({
    headers,
    body: {
      invitationId: input.invitationId,
    },
  })
}

export function updateOrganizationMemberRole(
  auth: AuthInstance,
  headers: Headers,
  input: {
    /** Better-Auth member 记录 id（非 user id） */
    memberId: string
    role: RealmOrganizationRole
  },
) {
  return auth.api.updateMemberRole({
    headers,
    body: {
      memberId: input.memberId,
      role: input.role,
    },
  })
}

export function removeOrganizationMember(
  auth: AuthInstance,
  headers: Headers,
  input: { /** Better-Auth member 记录 id 或成员邮箱 */ memberIdOrEmail: string },
) {
  return auth.api.removeMember({
    headers,
    body: {
      memberIdOrEmail: input.memberIdOrEmail,
    },
  })
}
