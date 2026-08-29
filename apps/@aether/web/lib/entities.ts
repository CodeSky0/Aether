// @aether/web · Realm 主体（Human 成员 + AI Entity）查询
// Current 页右侧面板的数据源：人类与 Entity 同列呈现，人机共处一态。
// Production 约定：入参过 zod 校验，返回 ActionResult。

'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { requireRealmAccess } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { entities, members, realms } from '@aether/db'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

export interface RealmActorRow {
  kind: 'human' | 'entity'
  id: string
  name: string
  status: string
}

const realmActorQuerySchema = z.object({ realmId: realmIdField })

/**
 * 列出 Realm 级主体：realm 级 human 成员（project_id IS NULL）+ 全部 Entity。
 * 列表内 human 在前、entity 在后，与右侧面板"1 Human + 1 AI Entity"的呈现一致。
 * Realm 已被软删除时返回空列表（页面层会先行 404）。
 */
export async function listRealmActors(
  realmId: string,
): Promise<ActionResult<RealmActorRow[]>> {
  return runGuarded('listRealmActors', async () => {
    const parsed = realmActorQuerySchema.parse({ realmId })
    await requireRealmAccess(parsed.realmId)
    const db = getDb()

    // Realm 已软删除：主体面板没有意义，直接返回空。
    const [realm] = await db
      .select({ id: realms.id })
      .from(realms)
      .where(and(eq(realms.id, parsed.realmId), isNull(realms.deleted_at)))
      .limit(1)
    if (!realm) return []

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
            eq(members.realm_id, parsed.realmId),
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
        .where(eq(entities.realm_id, parsed.realmId)),
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
  })
}
