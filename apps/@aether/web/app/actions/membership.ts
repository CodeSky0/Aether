// @aether/web · Realm membership 邀请 Server Actions
'use server'

import {
  acceptOrganizationInvitation,
  cancelOrganizationInvitation,
  inviteToOrganization,
  listOrganizationInvitations,
  type RealmOrganizationRole,
} from '@aether/auth'
import { members, realmGuard, realms } from '@aether/db'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { getDb } from '@/lib/db'
import { ensureRealmMembership } from '@/lib/membership-provisioning'
import {
  isPlaceholderOrganization,
  UNBOUND_REALM_ORGANIZATION_MESSAGE,
} from '@/lib/membership-utils'
import {
  requireEntitlement,
  resolveCurrentActor,
} from '@/lib/auth-guard'
import {
  MANAGE_MEMBER_ROLES,
  READ_MEMBER_ROLES,
  requireRealmRole,
} from '@/lib/membership-guard'
import { tryGetAuth } from '@/lib/auth'

const ALLOWED_ROLES = new Set(['owner', 'admin', 'member'])

function isAllowedRole(role: string): role is RealmOrganizationRole {
  return ALLOWED_ROLES.has(role)
}

interface RealmOrganization {
  id: string
  authOrgId: string
}

async function getRealmOrganization(
  realmId: string,
): Promise<RealmOrganization> {
  const [realm] = await getDb()
    .select({ id: realms.id, authOrgId: realms.auth_org_id })
    .from(realms)
    .where(eq(realms.id, realmId))
    .limit(1)
  if (!realm) throw new Error(`Realm not found: ${realmId}`)
  if (isPlaceholderOrganization(realm.authOrgId)) {
    throw new Error(UNBOUND_REALM_ORGANIZATION_MESSAGE)
  }
  return realm
}

function requireAuth() {
  const auth = tryGetAuth()
  if (auth === null) {
    throw new Error(
      'Better-Auth is not configured; authenticate and configure BETTER_AUTH_URL and BETTER_AUTH_SECRET first',
    )
  }
  return auth
}

async function requireAuthenticatedActor() {
  const actor = await resolveCurrentActor()
  if (actor === null) {
    throw new Error(
      'Cannot manage Realm membership without an authenticated session',
    )
  }
  return actor
}

export interface InviteRealmMemberInput {
  realmId: string
  email: string
  role: string
}

export async function inviteRealmMember(
  input: InviteRealmMemberInput,
) {
  const actor = await requireAuthenticatedActor()
  await requireEntitlement(input.realmId, {
    resource: 'realm',
    action: 'manage_member',
  })
  await requireRealmRole(input.realmId, actor, MANAGE_MEMBER_ROLES)
  const realm = await getRealmOrganization(input.realmId)
  if (!isAllowedRole(input.role)) {
    throw new Error('Invalid membership role: expected owner, admin, or member')
  }
  return inviteToOrganization(requireAuth(), await headers(), {
    organizationId: realm.authOrgId,
    email: input.email,
    role: input.role,
  })
}

export interface ListRealmInvitationsInput {
  realmId: string
}

export interface RealmInvitation {
  id: string
  organizationId: string
  email: string
  role: string
  status: string
  expiresAt: Date
  createdAt: Date
}

export async function listRealmInvitations(
  input: ListRealmInvitationsInput,
): Promise<RealmInvitation[]> {
  const actor = await requireAuthenticatedActor()
  await requireEntitlement(input.realmId, {
    resource: 'realm',
    action: 'read',
  })
  await requireRealmRole(input.realmId, actor, READ_MEMBER_ROLES)
  const realm = await getRealmOrganization(input.realmId)
  const invitations = await listOrganizationInvitations(requireAuth(), await headers(), {
    organizationId: realm.authOrgId,
  })
  return invitations.map((invitation) => ({
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  }))
}

export interface RealmMemberRow {
  id: string
  actor_type: 'human' | 'entity'
  actor_id: string
  role: string
  status: 'active' | 'suspended' | 'invited'
  project_id: string | null
  created_at: Date
}

export interface ListRealmMembersInput {
  realmId: string
}

export async function listRealmMembers(
  input: ListRealmMembersInput,
): Promise<{ members: RealmMemberRow[]; currentActorRole: string }> {
  const actor = await requireAuthenticatedActor()
  await requireEntitlement(input.realmId, {
    resource: 'realm',
    action: 'read',
  })
  const currentActorRole = await requireRealmRole(
    input.realmId,
    actor,
    READ_MEMBER_ROLES,
  )
  const rows = await getDb()
    .select({
      id: members.id,
      actor_type: members.actor_type,
      actor_id: members.actor_id,
      role: members.role,
      status: members.status,
      project_id: members.project_id,
      created_at: members.created_at,
    })
    .from(members)
    .where(realmGuard(members, input.realmId))

  return { members: rows, currentActorRole }
}

export interface RevokeRealmInvitationInput {
  realmId: string
  invitationId: string
}

export async function revokeRealmInvitation(
  input: RevokeRealmInvitationInput,
) {
  const actor = await requireAuthenticatedActor()
  await requireEntitlement(input.realmId, {
    resource: 'realm',
    action: 'manage_member',
  })
  await requireRealmRole(input.realmId, actor, MANAGE_MEMBER_ROLES)
  const realm = await getRealmOrganization(input.realmId)
  const auth = requireAuth()
  const requestHeaders = await headers()
  const invitationList = await listOrganizationInvitations(auth, requestHeaders, {
    organizationId: realm.authOrgId,
  })
  const invitation = invitationList.find(
    (candidate) =>
      candidate.id === input.invitationId &&
      candidate.organizationId === realm.authOrgId,
  )
  if (!invitation) {
    throw new Error('Invitation does not belong to this Realm organization')
  }
  return cancelOrganizationInvitation(auth, requestHeaders, {
    invitationId: invitation.id,
  })
}

export interface AcceptRealmInvitationInput {
  invitationId: string
}

export async function acceptRealmInvitation(
  input: AcceptRealmInvitationInput,
) {
  const actor = await resolveCurrentActor()
  if (actor === null) {
    throw new Error(
      'Cannot accept a Realm invitation without an authenticated session',
    )
  }
  const result = await acceptOrganizationInvitation(
    requireAuth(),
    await headers(),
    input,
  )
  const organizationId = result.invitation.organizationId
  const [realm] = await getDb()
    .select({ id: realms.id })
    .from(realms)
    .where(eq(realms.auth_org_id, organizationId))
    .limit(1)
  if (!realm) {
    throw new Error('Accepted invitation is not bound to an Aether Realm')
  }
  await ensureRealmMembership({
    realmId: realm.id,
    actorType: actor.actorType,
    actorId: actor.actorId,
  })
  return { ...result, realmId: realm.id }
}
