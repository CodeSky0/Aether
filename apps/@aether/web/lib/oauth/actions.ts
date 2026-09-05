// @aether/web · OAuth App Registry 管理 Server Actions
// 规则：App 注册/轮换/删除需 realm owner/admin（requireRealmRole）；
// 我的授权列表/吊销为授权用户本人操作。client_secret 明文仅注册/轮换时
// 返回一次；全部操作落审计（permission_change）。
'use server'

import { and, desc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'

import { oauthApps, oauthAuthorizations } from '@aether/db'
import {
  generateClientId,
  generateClientSecret,
  sha256Hex,
} from '@aether/resonance'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { recordPermissionChange } from '@/lib/audit-write'
import { requireRealmRole } from '@/lib/membership-guard'
import { runGuarded } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'
import {
  deleteOAuthAppInputSchema,
  registerOAuthAppInputSchema,
  revokeOAuthAuthorizationInputSchema,
  rotateOAuthAppSecretInputSchema,
} from './protocol'

export interface OAuthAppRow {
  id: string
  client_id: string
  name: string
  redirect_uris: string[]
  client_secret_prefix: string
  created_at: Date
}

export interface RegisteredOAuthApp extends OAuthAppRow {
  /** 明文 secret：仅此一次返回，刷新后不可再现 */
  client_secret: string
}

/** 注册 OAuth App（owner/admin）：client_id/secret 生成，明文 secret 仅返回一次。 */
export async function registerOAuthApp(
  input: z.infer<typeof registerOAuthAppInputSchema>,
): Promise<ActionResult<RegisteredOAuthApp>> {
  return runGuarded('registerOAuthApp', async () => {
    const parsed = registerOAuthAppInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Registering an OAuth app requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])

    const clientId = generateClientId()
    const clientSecret = generateClientSecret()
    const clientSecretHash = await sha256Hex(clientSecret)
    const [created] = await getDb()
      .insert(oauthApps)
      .values({
        realm_id: parsed.realmId,
        client_id: clientId,
        name: parsed.name,
        client_secret_hash: clientSecretHash,
        client_secret_prefix: clientSecret.slice(0, 12),
        redirect_uris: parsed.redirectUris,
        created_by: actor.actorId,
      })
      .returning({
        id: oauthApps.id,
        client_id: oauthApps.client_id,
        name: oauthApps.name,
        redirect_uris: oauthApps.redirect_uris,
        client_secret_prefix: oauthApps.client_secret_prefix,
        created_at: oauthApps.created_at,
      })
    if (!created) throw new Error('Failed to register OAuth app')

    await getDb().transaction(async (tx) => {
      await recordPermissionChange(tx, {
        realmId: parsed.realmId,
        actor: { actorType: 'human', actorId: actor.actorId },
        target: {
          kind: 'oauth_app',
          app_id: created.id,
          client_id: created.client_id,
          name: created.name,
          redirect_uris: created.redirect_uris,
        },
        idempotencyKey: `oauth:app.register:${created.id}`,
        result: { registered: true },
      })
    })
    return { ...created, client_secret: clientSecret }
  })
}

/** 列出 Realm 的有效 App（deleted_at IS NULL），按创建时间降序。 */
export async function listOAuthApps(input: {
  realmId: string
}): Promise<ActionResult<OAuthAppRow[]>> {
  return runGuarded('listOAuthApps', async () => {
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Listing OAuth apps requires an authenticated session')
    }
    await requireRealmRole(input.realmId, actor, ['owner', 'admin'])
    return getDb()
      .select({
        id: oauthApps.id,
        client_id: oauthApps.client_id,
        name: oauthApps.name,
        redirect_uris: oauthApps.redirect_uris,
        client_secret_prefix: oauthApps.client_secret_prefix,
        created_at: oauthApps.created_at,
      })
      .from(oauthApps)
      .where(
        and(eq(oauthApps.realm_id, input.realmId), isNull(oauthApps.deleted_at)),
      )
      .orderBy(desc(oauthApps.created_at))
  })
}

/** 轮换 client_secret（owner/admin）：新明文仅返回一次，旧 secret 立即失效。 */
export async function rotateOAuthAppSecret(
  input: z.infer<typeof rotateOAuthAppSecretInputSchema>,
): Promise<ActionResult<{ client_secret: string }>> {
  return runGuarded('rotateOAuthAppSecret', async () => {
    const parsed = rotateOAuthAppSecretInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Rotating an OAuth app secret requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])

    const clientSecret = generateClientSecret()
    const clientSecretHash = await sha256Hex(clientSecret)
    const [rotated] = await getDb()
      .update(oauthApps)
      .set({
        client_secret_hash: clientSecretHash,
        client_secret_prefix: clientSecret.slice(0, 12),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(oauthApps.id, parsed.appId),
          eq(oauthApps.realm_id, parsed.realmId),
          isNull(oauthApps.deleted_at),
        ),
      )
      .returning({ id: oauthApps.id })
    if (!rotated) throw new Error('App 不存在或已被删除')

    await getDb().transaction(async (tx) => {
      await recordPermissionChange(tx, {
        realmId: parsed.realmId,
        actor: { actorType: 'human', actorId: actor.actorId },
        target: { kind: 'oauth_app', app_id: parsed.appId, rotated: true },
        idempotencyKey: `oauth:app.rotate:${parsed.appId}:${Date.now()}`,
        result: { rotated: true },
      })
    })
    return { client_secret: clientSecret }
  })
}

/** 删除 App（owner/admin，软删除）：全部授权与 token 随之失效。 */
export async function deleteOAuthApp(
  input: z.infer<typeof deleteOAuthAppInputSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('deleteOAuthApp', async () => {
    const parsed = deleteOAuthAppInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Deleting an OAuth app requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])

    const [deleted] = await getDb()
      .update(oauthApps)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(oauthApps.id, parsed.appId),
          eq(oauthApps.realm_id, parsed.realmId),
          isNull(oauthApps.deleted_at),
        ),
      )
      .returning({ id: oauthApps.id })
    if (!deleted) throw new Error('App 不存在或已被删除')

    await getDb().transaction(async (tx) => {
      await recordPermissionChange(tx, {
        realmId: parsed.realmId,
        actor: { actorType: 'human', actorId: actor.actorId },
        target: { kind: 'oauth_app', app_id: parsed.appId, deleted: true },
        idempotencyKey: `oauth:app.delete:${parsed.appId}`,
        result: { deleted: true },
      })
    })
    return deleted
  })
}

export interface MyOAuthAuthorizationRow {
  id: string
  app_name: string
  app_client_id: string
  scopes: string[]
  token_prefix: string | null
  token_issued_at: Date | null
  last_used_at: Date | null
  created_at: Date
}

/** 列出当前用户在该 Realm 的授权（含已吊销，最近在前）。 */
export async function listMyOAuthAuthorizations(input: {
  realmId: string
}): Promise<ActionResult<MyOAuthAuthorizationRow[]>> {
  return runGuarded('listMyOAuthAuthorizations', async () => {
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Listing OAuth authorizations requires an authenticated session')
    }
    await requireRealmRole(input.realmId, actor, [
      'owner',
      'admin',
      'member',
      'viewer',
    ])
    return getDb()
      .select({
        id: oauthAuthorizations.id,
        app_name: oauthApps.name,
        app_client_id: oauthApps.client_id,
        scopes: oauthAuthorizations.scopes,
        token_prefix: oauthAuthorizations.token_prefix,
        token_issued_at: oauthAuthorizations.token_issued_at,
        last_used_at: oauthAuthorizations.last_used_at,
        created_at: oauthAuthorizations.created_at,
      })
      .from(oauthAuthorizations)
      .innerJoin(oauthApps, eq(oauthApps.id, oauthAuthorizations.app_id))
      .where(
        and(
          eq(oauthAuthorizations.realm_id, input.realmId),
          eq(oauthAuthorizations.user_id, actor.actorId),
        ),
      )
      .orderBy(desc(oauthAuthorizations.created_at))
      .limit(100)
  })
}

/** 吊销自己的授权 token（本人操作；幂等：已吊销再次吊销仍成功）。 */
export async function revokeOAuthAuthorization(
  input: z.infer<typeof revokeOAuthAuthorizationInputSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('revokeOAuthAuthorization', async () => {
    const parsed = revokeOAuthAuthorizationInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Revoking an OAuth authorization requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, [
      'owner',
      'admin',
      'member',
      'viewer',
    ])

    const [revoked] = await getDb()
      .update(oauthAuthorizations)
      .set({ revoked_at: new Date() })
      .where(
        and(
          eq(oauthAuthorizations.id, parsed.authorizationId),
          eq(oauthAuthorizations.realm_id, parsed.realmId),
          eq(oauthAuthorizations.user_id, actor.actorId),
          isNull(oauthAuthorizations.revoked_at),
        ),
      )
      .returning({ id: oauthAuthorizations.id })
    if (!revoked) throw new Error('授权不存在或已被吊销')

    await getDb().transaction(async (tx) => {
      await recordPermissionChange(tx, {
        realmId: parsed.realmId,
        actor: { actorType: 'human', actorId: actor.actorId },
        target: {
          kind: 'oauth_authorization',
          authorization_id: parsed.authorizationId,
          revoked: true,
        },
        idempotencyKey: `oauth:revoke:${parsed.authorizationId}`,
        result: { revoked: true },
      })
    })
    return revoked
  })
}
