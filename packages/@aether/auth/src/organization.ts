// @aether/auth · Better-Auth organization 操作薄封装
// 下游经本模块调用 organization API，不直接依赖 Better-Auth。
import type { AuthInstance } from './instance.js'
import { and, eq } from 'drizzle-orm'
import { member } from './schema.js'
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
