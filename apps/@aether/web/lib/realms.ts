// @aether/web · Realm 列表与创建 Server Actions
'use server'

import { getDb, isDatabaseConfigured } from '@/lib/db'
import { members, realms } from '@aether/db'
import { desc } from 'drizzle-orm'
import { createRealmOrganization } from '@aether/auth'
import { tryGetAuth } from '@/lib/auth'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { recordPermissionChange } from '@/lib/audit-write'

export interface RealmRow {
  id: string
  slug: string
  name: string
  created_at: Date
}

/**
 * 列出所有 Realm，按创建时间降序。
 * M1 阶段无 auth 守卫，后续接入认证后可加 userId 过滤。
 */
export async function listRealms(): Promise<RealmRow[]> {
  // 预览环境可能尚未注入 Vercel 项目变量；不要让只读页面直接崩溃。
  if (!isDatabaseConfigured()) return []

  try {
    const db = getDb()
    return await db
      .select()
      .from(realms)
      .orderBy(desc(realms.created_at))
  } catch (error) {
    console.error('[v0] Failed to load realms:', error)
    return []
  }
}

export interface CreateRealmInput {
  slug: string
  name: string
}

/**
 * 创建新 Realm。
 * 已配置认证且存在会话时绑定真实 organization 并开通 owner；
 * 其他情况保留占位 organization，兼容未配置认证的开发环境。
 */
export async function createRealm(
  input: CreateRealmInput,
): Promise<{ id: string; slug: string; name: string }> {
  const db = getDb()
  const auth = tryGetAuth()
  const actor = auth === null ? null : await resolveCurrentActor()

  if (auth !== null && actor !== null) {
    const organization = await createRealmOrganization(auth, {
      name: input.name,
      slug: input.slug,
      ownerUserId: actor.actorId,
    })
    return db.transaction(async (tx) => {
      const [realm] = await tx
        .insert(realms)
        .values({
          slug: input.slug,
          name: input.name,
          auth_org_id: organization.id,
          schema_namespace: `ns_${input.slug}`,
          residency: 'vercel',
        })
        .returning({ id: realms.id, slug: realms.slug, name: realms.name })
      if (!realm) throw new Error('Failed to create realm')

      await tx.insert(members).values({
        realm_id: realm.id,
        project_id: null,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        role: 'owner',
        entitlements: {},
        status: 'active',
      })
      await recordPermissionChange(tx, {
        realmId: realm.id,
        actor,
        target: {
          kind: 'realm_membership',
          role: 'owner',
          actor_id: actor.actorId,
        },
        idempotencyKey: `realm-owner:${realm.id}:${actor.actorId}`,
        result: { status: 'active' },
      })
      return realm
    })
  }

  const [realm] = await db
    .insert(realms)
    .values({
      slug: input.slug,
      name: input.name,
      auth_org_id: `org-placeholder-${Date.now()}`,
      schema_namespace: `ns_${input.slug}`,
      residency: 'vercel',
    })
    .returning({ id: realms.id, slug: realms.slug, name: realms.name })

  if (!realm) {
    throw new Error('Failed to create realm')
  }
  return realm
}
