// @aether/web · Realm 列表与创建 Server Actions
'use server'

import { getDb, isDatabaseConfigured } from '@/lib/db'
import { entities, members, projects, realms, threads } from '@aether/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { createRealmOrganization } from '@aether/auth'
import { tryGetAuth } from '@/lib/auth'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { recordPermissionChange } from '@/lib/audit-write'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  name: string
  /** 缺省时从名称自动生成不冲突的 slug */
  slug?: string
}

export interface RealmCardRow extends RealmRow {
  /** status='active' 的 Entity 数量：RealmCard 脉冲点的数据源 */
  activeEntityCount: number
  /** 最新 Thread 标题；Realm 内无 Thread 时为 null */
  lastThreadTitle: string | null
}

/**
 * Dashboard / Realms 列表：Realm + 活跃 Entity 计数 + 最新 Thread 标题。
 * 计数取 entities.status='active'；最新 Thread 以 DISTINCT ON 每个 Realm 取一行。
 */
export async function listRealmCards(): Promise<RealmCardRow[]> {
  // 预览环境可能尚未注入数据库变量；不要让只读页面直接崩溃。
  if (!isDatabaseConfigured()) return []

  try {
    const db = getDb()
    const realmRows = await db
      .select()
      .from(realms)
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
      .orderBy(threads.realm_id, desc(threads.created_at))

    const countByRealm = new Map(entityCounts.map((r) => [r.realmId, r.count]))
    const threadByRealm = new Map(latestThreads.map((r) => [r.realmId, r.title]))

    return realmRows.map((realm) => ({
      ...realm,
      activeEntityCount: countByRealm.get(realm.id) ?? 0,
      lastThreadTitle: threadByRealm.get(realm.id) ?? null,
    }))
  } catch (error) {
    console.error('[v0] Failed to load realm cards:', error)
    return []
  }
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
): Promise<{ id: string; slug: string; name: string }> {
  const db = getDb()
  const auth = tryGetAuth()
  const actor = auth === null ? null : await resolveCurrentActor()
  const slug = input.slug?.trim() || (await generateUniqueSlug(db, input.name))

  if (auth !== null && actor !== null) {
    const organization = await createRealmOrganization(auth, {
      name: input.name,
      slug,
      ownerUserId: actor.actorId,
    })
    return db.transaction(async (tx) => {
      const [realm] = await tx
        .insert(realms)
        .values({
          slug,
          name: input.name,
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
        name: input.name,
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

/** 按 id 读取单个 Realm；id 非法或不存在返回 null。 */
export async function getRealm(id: string): Promise<RealmRow | null> {
  if (!isDatabaseConfigured()) return null
  if (!UUID_REGEX.test(id)) return null
  try {
    const db = getDb()
    const rows = await db
      .select({
        id: realms.id,
        slug: realms.slug,
        name: realms.name,
        created_at: realms.created_at,
      })
      .from(realms)
      .where(eq(realms.id, id))
      .limit(1)
    return rows[0] ?? null
  } catch (error) {
    console.error('[v0] Failed to load realm:', error)
    return null
  }
}

/** 取 Realm 的默认 Project（main）；不存在则创建。Thread 创建的挂载点。 */
export async function ensureDefaultProject(realmId: string): Promise<string> {
  const db = getDb()
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.realm_id, realmId), eq(projects.slug, 'main')))
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(projects)
    .values({
      realm_id: realmId,
      slug: 'main',
      name: 'Main',
      default_branch: 'main',
    })
    .returning({ id: projects.id })
  if (!created) throw new Error('Failed to create default project')
  return created.id
}
