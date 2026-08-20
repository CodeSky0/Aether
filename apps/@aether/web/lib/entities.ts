// @aether/web · Realm 主体（Human 成员 + AI Entity）查询
// Current 页右侧面板的数据源：人类与 Entity 同列呈现，人机共处一态。
'use server'

import { and, eq, isNull } from 'drizzle-orm'

import { requireRealmAccess } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { entities, members } from '@aether/db'

export interface RealmActorRow {
  kind: 'human' | 'entity'
  id: string
  name: string
  status: string
}

/**
 * 列出 Realm 级主体：realm 级 human 成员（project_id IS NULL）+ 全部 Entity。
 * 列表内 human 在前、entity 在后，与右侧面板"1 Human + 1 AI Entity"的呈现一致。
 */
export async function listRealmActors(realmId: string): Promise<RealmActorRow[]> {
  await requireRealmAccess(realmId)
  const db = getDb()
  const [memberRows, entityRows] = await Promise.all([
    db
      .select({
        id: members.id,
        actor_type: members.actor_type,
        actor_id: members.actor_id,
        role: members.role,
        status: members.status,
      })
      .from(members)
      .where(
        and(
          eq(members.realm_id, realmId),
          isNull(members.project_id),
          eq(members.actor_type, 'human'),
        ),
      ),
    db
      .select({
        id: entities.id,
        display_name: entities.display_name,
        status: entities.status,
      })
      .from(entities)
      .where(eq(entities.realm_id, realmId)),
  ])

  const humans: RealmActorRow[] = memberRows.map((m) => ({
    kind: 'human',
    id: m.actor_id,
    name: m.actor_id === 'local-user' ? 'You' : m.actor_id,
    status: m.status,
  }))
  const aiEntities: RealmActorRow[] = entityRows.map((e) => ({
    kind: 'entity',
    id: e.id,
    name: e.display_name,
    status: e.status,
  }))
  return [...humans, ...aiEntities]
}
