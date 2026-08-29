// @aether/web · Realm 列表与创建 Server Actions
// Production 约定：入参过 zod 校验，返回 ActionResult，软删除 Realm 一律过滤。

'use server'

import { getDb, isDatabaseConfigured } from '@/lib/db'
import { entities, members, projects, realms, threads } from '@aether/db'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createRealmOrganization } from '@aether/auth'
import { tryGetAuth } from '@/lib/auth'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { requireRealmRole } from '@/lib/membership-guard'
import { recordPermissionChange } from '@/lib/audit-write'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

export interface RealmRow {
  id: string
  slug: string
  name: string
  created_at: Date
}

/**
 * 列出所有未删除的 Realm，按创建时间降序。
 * M1 阶段无 auth 守卫，后续接入认证后可加 userId 过滤。
 */
export async function listRealms(): Promise<ActionResult<RealmRow[]>> {
  // 预览环境可能尚未注入 Vercel 项目变量；不要让只读页面直接崩溃。
  if (!isDatabaseConfigured()) return { success: true, data: [] }

  return runGuarded('listRealms', async () => {
    const db = getDb()
    return db
      .select()
      .from(realms)
      .where(isNull(realms.deleted_at))
      .orderBy(desc(realms.created_at))
  })
}

export interface CreateRealmInput {
  name: string
  /** 缺省时从名称自动生成不冲突的 slug */
  slug?: string
}

const createRealmInputSchema = z.object({
  name: z.string().trim().min(1, 'Realm 名称不能为空').max(100, '名称最长 100 字符'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 只能包含小写字母、数字与连字符')
    .max(40, 'slug 最长 40 字符')
    .optional(),
})

export interface RealmCardRow extends RealmRow {
  /** status='active' 的 Entity 数量：RealmCard 脉冲点的数据源 */
  activeEntityCount: number
  /** 最新 Thread 标题；Realm 内无 Thread 时为 null */
  lastThreadTitle: string | null
}

/**
 * Dashboard / Realms 列表：Realm + 活跃 Entity 计数 + 最新 Thread 标题。
 * 计数取 entities.status='active'；最新 Thread 以 DISTINCT ON 每个 Realm 取一行。
 * 软删除的 Realm 与 Thread 不参与统计。
 */
export async function listRealmCards(): Promise<ActionResult<RealmCardRow[]>> {
  // 预览环境可能尚未注入数据库变量；不要让只读页面直接崩溃。
  if (!isDatabaseConfigured()) return { success: true, data: [] }

  return runGuarded('listRealmCards', async () => {
    const db = getDb()
    const realmRows = await db
      .select()
      .from(realms)
      .where(isNull(realms.deleted_at))
      .orderBy(desc(realms.created_at))

    const entityCounts = await db
      .select({ realmId: entities.realm_id, count: sql<number>`count(*)::int` })
      .from(entities)
      .where(eq(entities.status, 'active'))
      .groupBy(entities.realm_id)

    const latestThreads = await db
      .selectDistinctOn([threads.realm_id], {
        realmId: threads.realm_id,
        title: threads.title,
      })
      .from(threads)
      .where(isNull(threads.deleted_at))
      .orderBy(threads.realm_id, desc(threads.created_at))

    const countByRealm = new Map(entityCounts.map((r) => [r.realmId, r.count]))
    const threadByRealm = new Map(latestThreads.map((r) => [r.realmId, r.title]))

    return realmRows.map((realm) => ({
      ...realm,
      activeEntityCount: countByRealm.get(realm.id) ?? 0,
      lastThreadTitle: threadByRealm.get(realm.id) ?? null,
    }))
  })
}

/**
 * 创建新 Realm（核心环 Step 3-4：用户只需命名，slug 自动生成）。
 * 创建即完成三件事，保证 Current 页开箱可用：
 *   1. 默认 Project（main）——Thread 挂载点
 *   2. Owner 成员（human）——右侧面板的"1 Human"
 *   3. 种子 Entity（Aether Entity）——右侧面板的"1 AI Entity"
 */
export async function createRealm(
  input: CreateRealmInput,
): Promise<ActionResult<{ id: string; slug: string; name: string }>> {
  return runGuarded('createRealm', async () => {
    const parsed = createRealmInputSchema.parse(input)
    const db = getDb()
    const auth = tryGetAuth()
    const actor = auth === null ? null : await resolveCurrentActor()
    const slug = parsed.slug?.trim() || (await generateUniqueSlug(db, parsed.name))

    if (auth !== null && actor !== null) {
      const organization = await createRealmOrganization(auth, {
        name: parsed.name,
        slug,
        ownerUserId: actor.actorId,
      })
      return db.transaction(async (tx) => {
        const [realm] = await tx
          .insert(realms)
          .values({
            slug,
            name: parsed.name,
            auth_org_id: organization.id,
            schema_namespace: `ns_${slug}`,
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
        await seedRealmDefaults(tx, realm.id)
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

    // 未配置认证的开发环境：占位 organization + 本地 owner 成员
    return db.transaction(async (tx) => {
      const [realm] = await tx
        .insert(realms)
        .values({
          slug,
          name: parsed.name,
          auth_org_id: `org-placeholder-${Date.now()}`,
          schema_namespace: `ns_${slug}`,
          residency: 'vercel',
        })
        .returning({ id: realms.id, slug: realms.slug, name: realms.name })
      if (!realm) throw new Error('Failed to create realm')

      await tx.insert(members).values({
        realm_id: realm.id,
        project_id: null,
        actor_type: 'human',
        actor_id: 'local-user',
        role: 'owner',
        entitlements: {},
        status: 'active',
      })
      await seedRealmDefaults(tx, realm.id)
      return realm
    })
  })
}

/** 从名称生成 slug：小写、非字母数字折叠为 -、去首尾 -、截断 40 字符。 */
function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'realm'
}

/** 生成不冲突的 slug：base、base-2、base-3… */
async function generateUniqueSlug(
  db: ReturnType<typeof getDb>,
  name: string,
): Promise<string> {
  const base = slugifyName(name)
  const existing = await db
    .select({ slug: realms.slug })
    .from(realms)
    .where(sql`${realms.slug} = ${base} or ${realms.slug} like ${`${base}-%`}`)
  // 注意：软删除的 Realm 仍占用 slug 唯一索引，冲突检查需包含它们。
  const taken = new Set(existing.map((row) => row.slug))
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/**
 * 为新 Realm 播种默认 Project 与种子 Entity（同一事务内）。
 * tx 类型沿用 drizzle 事务回调参数。
 */
async function seedRealmDefaults(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  realmId: string,
): Promise<void> {
  await tx.insert(projects).values({
    realm_id: realmId,
    slug: 'main',
    name: 'Main',
    default_branch: 'main',
  })
  await tx.insert(entities).values({
    realm_id: realmId,
    auth_identity_id: `seed:${realmId}`,
    display_name: 'Aether Entity',
    capability_manifesto: {},
    status: 'active',
    memory_ref: {},
  })
}

const getRealmIdSchema = realmIdField

/** 按 id 读取单个未删除 Realm；id 非法或不存在返回 null。 */
export async function getRealm(id: string): Promise<ActionResult<RealmRow | null>> {
  return runGuarded('getRealm', async () => {
    if (!isDatabaseConfigured()) return null
    const realmId = getRealmIdSchema.parse(id)
    const db = getDb()
    const rows = await db
      .select({
        id: realms.id,
        slug: realms.slug,
        name: realms.name,
        created_at: realms.created_at,
      })
      .from(realms)
      .where(and(eq(realms.id, realmId), isNull(realms.deleted_at)))
      .limit(1)
    return rows[0] ?? null
  })
}

/** 取 Realm 的默认 Project（main）；不存在则创建。Thread 创建的挂载点。 */
export async function ensureDefaultProject(
  realmId: string,
): Promise<ActionResult<string>> {
  return runGuarded('ensureDefaultProject', async () => {
    const parsedRealmId = realmIdField.parse(realmId)
    const db = getDb()
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.realm_id, parsedRealmId),
          eq(projects.slug, 'main'),
        ),
      )
      .limit(1)
    if (existing[0]) return existing[0].id

    const [created] = await db
      .insert(projects)
      .values({
        realm_id: parsedRealmId,
        slug: 'main',
        name: 'Main',
        default_branch: 'main',
      })
      .returning({ id: projects.id })
    if (!created) throw new Error('Failed to create default project')
    return created.id
  })
}

// ---- Realm Settings（Step 4：改名 + 危险区软删除）----

const renameRealmInputSchema = z.object({
  realmId: realmIdField,
  name: z.string().trim().min(1, 'Realm 名称不能为空').max(100, '名称最长 100 字符'),
})

/** 重命名 Realm；要求 owner/admin 角色（membership 守卫不可被功能开关关闭）。 */
export async function renameRealm(
  input: z.infer<typeof renameRealmInputSchema>,
): Promise<ActionResult<{ id: string; name: string }>> {
  return runGuarded('renameRealm', async () => {
    const parsed = renameRealmInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Renaming a Realm requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const [updated] = await db
      .update(realms)
      .set({ name: parsed.name, updated_at: new Date() })
      .where(and(eq(realms.id, parsed.realmId), isNull(realms.deleted_at)))
      .returning({ id: realms.id, name: realms.name })
    if (!updated) throw new Error('Realm 不存在或已被删除')
    return updated
  })
}

const deleteRealmInputSchema = z.object({
  realmId: realmIdField,
  /** 客户端必须先让用户键入 "DELETE" 才发请求；服务端不复核该值（它只是 UI 仪式），
      真正的防线是 owner-only 角色守卫。 */
})

/** 软删除 Realm（Danger Zone）：仅 owner。slug 唯一索引继续占用，防误恢复冲突。 */
export async function deleteRealm(
  input: z.infer<typeof deleteRealmInputSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('deleteRealm', async () => {
    const parsed = deleteRealmInputSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) {
      throw new Error('Deleting a Realm requires an authenticated session')
    }
    await requireRealmRole(parsed.realmId, actor, ['owner'])

    const db = getDb()
    const now = new Date()
    // Realm 主行软删除 + 活跃 Thread 一并软删除，同一事务。
    return db.transaction(async (tx) => {
      const [deleted] = await tx
        .update(realms)
        .set({ deleted_at: now, updated_at: now })
        .where(and(eq(realms.id, parsed.realmId), isNull(realms.deleted_at)))
        .returning({ id: realms.id })
      if (!deleted) throw new Error('Realm 不存在或已被删除')

      await tx
        .update(threads)
        .set({ deleted_at: now, updated_at: now })
        .where(
          and(eq(threads.realm_id, parsed.realmId), isNull(threads.deleted_at)),
        )

      await recordPermissionChange(tx, {
        realmId: parsed.realmId,
        actor,
        target: { kind: 'realm', realm_id: parsed.realmId },
        idempotencyKey: `realm-delete:${parsed.realmId}`,
        result: { status: 'deleted', deleted_at: now.toISOString() },
      })
      return deleted
    })
  })
}
