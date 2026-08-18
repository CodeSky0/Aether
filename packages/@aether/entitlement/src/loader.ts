// @aether/entitlement · Entitlement Engine Drizzle 加载层
import { and, eq } from 'drizzle-orm'
import type {
  PgDatabase,
  PgQueryResultHKT,
} from 'drizzle-orm/pg-core'
import type { TablesRelationalConfig } from 'drizzle-orm'
import { members, realmGuard } from '@aether/db'
import type { ActorType } from '@aether/types'
import type {
  EntitlementMembership,
  EntitlementSubject,
} from './evaluate.js'

function isEntitlements(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function loadEntitlementSubject<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  params: { realmId: string; actorType: ActorType; actorId: string },
): Promise<EntitlementSubject> {
  const guard = realmGuard(
    members,
    params.realmId,
  )
  const rows = await db
    .select({
      actor_type: members.actor_type,
      actor_id: members.actor_id,
      role: members.role,
      project_id: members.project_id,
      status: members.status,
      entitlements: members.entitlements,
    })
    .from(members)
    .where(
      and(
        guard,
        eq(members.actor_type, params.actorType),
        eq(members.actor_id, params.actorId),
      ),
    )

  const memberships: EntitlementMembership[] = rows.map((row) => ({
    role: row.role,
    projectId: row.project_id,
    status: row.status,
    entitlements: isEntitlements(row.entitlements)
      ? row.entitlements
      : {},
  }))
  return {
    realmId: params.realmId,
    actorType: params.actorType,
    actorId: params.actorId,
    memberships,
  }
}
