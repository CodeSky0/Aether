// @aether/web · Better-Auth 到 Aether membership 的 JIT 镜像
import { findOrganizationMemberRoles } from '@aether/auth'
import { members, realms, realmGuard } from '@aether/db'
import type { ActorType } from '@aether/types'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { recordPermissionChange } from '@/lib/audit-write'
import { isPlaceholderOrganization } from '@/lib/membership-utils'

const ROLE_PRIORITY = ['owner', 'admin', 'member'] as const
type RealmRole = (typeof ROLE_PRIORITY)[number]
const warnedUnknownRoles = new Set<string>()

export interface EnsureRealmMembershipInput {
  realmId: string
  actorType: ActorType
  actorId: string
}

function warnUnknownRole(role: string): void {
  if (warnedUnknownRoles.has(role)) return
  warnedUnknownRoles.add(role)
  // eslint-disable-next-line no-console
  console.warn(`[membership] Unknown Better-Auth organization role skipped: ${role}`)
}

export async function ensureRealmMembership(
  input: EnsureRealmMembershipInput,
): Promise<void> {
  const db = getDb()
  const activeMembership = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        realmGuard(members, input.realmId),
        eq(members.actor_type, input.actorType),
        eq(members.actor_id, input.actorId),
        eq(members.status, 'active'),
      ),
    )
    .limit(1)

  if (activeMembership.length > 0) return
  if (input.actorType !== 'human') return

  const [realm] = await db
    .select({ authOrgId: realms.auth_org_id })
    .from(realms)
    .where(eq(realms.id, input.realmId))
    .limit(1)
  if (!realm || isPlaceholderOrganization(realm.authOrgId)) return

  const roles = await findOrganizationMemberRoles(db, {
    organizationId: realm.authOrgId,
    userId: input.actorId,
  })
  const knownRoles = roles.filter((role): role is RealmRole => {
    if (ROLE_PRIORITY.includes(role as RealmRole)) return true
    warnUnknownRole(role)
    return false
  })
  const role = ROLE_PRIORITY.find((candidate) => knownRoles.includes(candidate))
  if (role === undefined) return

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(members)
      .values({
        realm_id: input.realmId,
        project_id: null,
        actor_type: input.actorType,
        actor_id: input.actorId,
        role,
        entitlements: {},
        status: 'active',
      })
      .onConflictDoNothing()
      .returning({ id: members.id })

    if (inserted.length === 0) return
    await recordPermissionChange(tx, {
      realmId: input.realmId,
      actor: {
        actorType: input.actorType,
        actorId: input.actorId,
      },
      target: {
        kind: 'realm_membership',
        role,
        actor_id: input.actorId,
      },
      idempotencyKey: `membership:${input.realmId}:${input.actorId}:${role}`,
      result: { status: 'active' },
    })
  })
}
