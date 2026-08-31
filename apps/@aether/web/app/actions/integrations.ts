// @aether/web · Realm 集成管理 Server Actions
// Production 约定：入参过 zod 校验，返回 ActionResult，权限校验不可被功能开关绕过。
'use server'

import { realmIntegrations } from '@aether/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import {
  resolveCurrentActor,
  requireEntitlement,
} from '@/lib/auth-guard'
import {
  MANAGE_MEMBER_ROLES,
  requireRealmRole,
} from '@/lib/membership-guard'
import { runGuarded, realmIdField, uuidField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

export interface DisconnectIntegrationInput {
  realmId: string
  integrationId: string
}

const disconnectInputSchema = z.object({
  realmId: realmIdField,
  integrationId: uuidField,
})

/** 软删除 Realm 集成（置 deleted_at，保留审计线索）。仅 owner/admin 可操作。 */
export async function disconnectIntegration(
  input: DisconnectIntegrationInput,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('disconnectIntegration', async () => {
    const parsed = disconnectInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error(
        'Cannot disconnect integration without an authenticated session',
      )
    }
    await requireEntitlement(parsed.realmId, {
      resource: 'realm',
      action: 'update',
    })
    await requireRealmRole(parsed.realmId, actor, MANAGE_MEMBER_ROLES)

    const db = getDb()
    const [existing] = await db
      .select({ id: realmIntegrations.id })
      .from(realmIntegrations)
      .where(
        and(
          eq(realmIntegrations.id, parsed.integrationId),
          eq(realmIntegrations.realm_id, parsed.realmId),
          isNull(realmIntegrations.deleted_at),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new Error('Integration not found or already disconnected')
    }

    await db
      .update(realmIntegrations)
      .set({ status: 'disconnected', deleted_at: new Date(), updated_at: new Date() })
      .where(eq(realmIntegrations.id, existing.id))
    return { id: existing.id }
  })
}
