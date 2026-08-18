// @aether/auth · 既有占位 Realm organization 回填脚本
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import {
  auditLog,
  members,
  realms,
} from '@aether/db'
import * as coreSchema from '@aether/db/schema'
import {
  betterAuthSchema,
} from '../src/schema.js'
import { createAuth } from '../src/instance.js'
import {
  createRealmOrganization,
  findOrganizationMemberRoles,
  isPlaceholderOrganization,
} from '../src/organization.js'
import { organization, user } from '../src/schema.js'
import { createHash } from 'node:crypto'

export interface BackfillArgs {
  apply: boolean
  ownerEmail?: string
  realmOwners: ReadonlyMap<string, string>
}

export interface BackfillRealm {
  id: string
  slug: string
  name: string
  authOrgId: string
}

export interface BackfillSummary {
  processed: number
  skipped: number
  failed: number
  skippedReasons: string[]
  failureReasons: string[]
}

export interface BackfillDependencies {
  findUserIdByEmail(email: string): Promise<string | null>
  /**
   * 查找可复用的同名 slug organization：
   * 上一轮在建 organization 之后、写 Realm 绑定之前失败会留下孤儿 organization，
   * 而 organization.slug 唯一，重跑必然撞约束。复用孤儿使回填可重试。
   * 已被其它 Realm 绑定时抛错，避免把两个 Realm 指向同一 organization。
   */
  findReusableOrganizationId(input: {
    slug: string
    ownerUserId: string
  }): Promise<string | null>
  createOrganization(input: {
    name: string
    slug: string
    ownerUserId: string
  }): Promise<{ id: string }>
  applyRealm(input: {
    realm: BackfillRealm
    organizationId: string
    ownerUserId: string
  }): Promise<void>
}

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let apply = false
  let ownerEmail: string | undefined
  const realmOwners = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--owner-email') {
      const value = argv[index + 1]
      if (!value) throw new Error('--owner-email requires an email')
      ownerEmail = value
      index += 1
      continue
    }
    if (argument === '--realm') {
      const value = argv[index + 1]
      if (!value) throw new Error('--realm requires <slug>=<email>')
      const separator = value.indexOf('=')
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error('--realm requires <slug>=<email>')
      }
      realmOwners.set(value.slice(0, separator), value.slice(separator + 1))
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  return ownerEmail === undefined
    ? { apply, realmOwners }
    : { apply, ownerEmail, realmOwners }
}

export function resolveOwnerEmail(
  realmSlug: string,
  args: Pick<BackfillArgs, 'ownerEmail' | 'realmOwners'>,
): string | undefined {
  return args.realmOwners.get(realmSlug) ?? args.ownerEmail
}

function emptySummary(): BackfillSummary {
  return {
    processed: 0,
    skipped: 0,
    failed: 0,
    skippedReasons: [],
    failureReasons: [],
  }
}

export async function runBackfill(
  realmsToProcess: readonly BackfillRealm[],
  dependencies: BackfillDependencies,
  args: BackfillArgs,
): Promise<BackfillSummary> {
  const summary = emptySummary()
  const realmSlugs = new Set(realmsToProcess.map((realm) => realm.slug))

  for (const realm of realmsToProcess) {
    if (!isPlaceholderOrganization(realm.authOrgId)) {
      summary.skipped += 1
      summary.skippedReasons.push(`${realm.slug}: already bound`)
      continue
    }

    const ownerEmail = resolveOwnerEmail(realm.slug, args)
    if (!ownerEmail) {
      summary.skipped += 1
      summary.skippedReasons.push(`${realm.slug}: owner email not provided`)
      continue
    }

    const ownerUserId = await dependencies.findUserIdByEmail(ownerEmail)
    if (!ownerUserId) {
      summary.failed += 1
      summary.failureReasons.push(`${realm.slug}: owner user not found`)
      continue
    }

    if (!args.apply) {
      summary.processed += 1
      continue
    }

    try {
      const reusableOrganizationId =
        await dependencies.findReusableOrganizationId({
          slug: realm.slug,
          ownerUserId,
        })
      const organizationId =
        reusableOrganizationId ??
        (
          await dependencies.createOrganization({
            name: realm.name,
            slug: realm.slug,
            ownerUserId,
          })
        ).id
      await dependencies.applyRealm({
        realm,
        organizationId,
        ownerUserId,
      })
      summary.processed += 1
    } catch (error) {
      summary.failed += 1
      summary.failureReasons.push(
        `${realm.slug}: ${safeErrorMessage(error)}`,
      )
    }
  }

  for (const overrideSlug of args.realmOwners.keys()) {
    if (realmSlugs.has(overrideSlug)) continue
    summary.failed += 1
    summary.failureReasons.push(
      `${overrideSlug}: --realm override did not match any Realm`,
    )
  }

  return summary
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted database url]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  }
  return 'unknown error'
}

function computePayloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex')
}

function createDependencies(
  databaseUrl: string,
  baseURL: string,
  secret: string,
) {
  const client = postgres(databaseUrl, { max: 1 })
  const schema = { ...coreSchema, ...betterAuthSchema }
  const db = drizzle(client, { schema })
  const auth = createAuth({
    db,
    baseURL,
    secret,
    mailer: {
      async sendInvitation() {
        // Backfill never sends invitations.
      },
    },
  })

  const dependencies: BackfillDependencies & {
    listRealms(): Promise<BackfillRealm[]>
  } = {
    async listRealms() {
      return db
        .select({
          id: realms.id,
          slug: realms.slug,
          name: realms.name,
          authOrgId: realms.auth_org_id,
        })
        .from(realms)
    },
    async findUserIdByEmail(email) {
      const [row] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1)
      return row?.id ?? null
    },
    async findReusableOrganizationId({ slug, ownerUserId }) {
      const [existing] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(1)
      if (!existing) return null

      const [boundRealm] = await db
        .select({ slug: realms.slug })
        .from(realms)
        .where(eq(realms.auth_org_id, existing.id))
        .limit(1)
      if (boundRealm) {
        throw new Error(
          `organization slug ${slug} is already bound to Realm ${boundRealm.slug}`,
        )
      }

      const ownerRoles = await findOrganizationMemberRoles(db, {
        organizationId: existing.id,
        userId: ownerUserId,
      })
      if (!ownerRoles.includes('owner')) {
        throw new Error(
          `organization slug ${slug} exists without the requested owner; resolve it manually`,
        )
      }
      return existing.id
    },
    createOrganization(input) {
      return createRealmOrganization(auth, input)
    },
    async applyRealm({ realm, organizationId, ownerUserId }) {
      const target = {
        kind: 'realm_membership',
        role: 'owner',
        actor_id: ownerUserId,
      }
      await db.transaction(async (tx) => {
        await tx
          .update(realms)
          .set({ auth_org_id: organizationId })
          .where(eq(realms.id, realm.id))
        await tx
          .insert(members)
          .values({
            realm_id: realm.id,
            project_id: null,
            actor_type: 'human',
            actor_id: ownerUserId,
            role: 'owner',
            entitlements: {},
            status: 'active',
          })
          .onConflictDoNothing()
        await tx.insert(auditLog).values({
          realm_id: realm.id,
          actor_type: 'human',
          actor_id: ownerUserId,
          action: 'permission_change',
          target,
          payload_hash: computePayloadHash(target),
          idempotency_key: `realm-owner:${realm.id}:${ownerUserId}`,
          result: { status: 'active' },
        })
      })
    },
  }

  return { client, dependencies }
}

function printSummary(summary: BackfillSummary, apply: boolean): void {
  // eslint-disable-next-line no-console
  console.log(`[backfill] mode=${apply ? 'apply' : 'dry-run'}`)
  // eslint-disable-next-line no-console
  console.log(
    `[backfill] processed=${summary.processed} skipped=${summary.skipped} failed=${summary.failed}`,
  )
  for (const reason of summary.skippedReasons) {
    // eslint-disable-next-line no-console
    console.log(`[backfill] skipped: ${reason}`)
  }
  for (const reason of summary.failureReasons) {
    // eslint-disable-next-line no-console
    console.log(`[backfill] failed: ${reason}`)
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseBackfillArgs(argv)
  const databaseUrl = environment.AETHER_DATABASE_URL
  const baseURL = environment.BETTER_AUTH_URL
  const secret = environment.BETTER_AUTH_SECRET
  if (!databaseUrl) throw new Error('AETHER_DATABASE_URL is required')
  if (!baseURL) throw new Error('BETTER_AUTH_URL is required')
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required')

  const { client, dependencies } = createDependencies(
    databaseUrl,
    baseURL,
    secret,
  )
  try {
    const realmsToProcess = await dependencies.listRealms()
    const summary = await runBackfill(realmsToProcess, dependencies, args)
    printSummary(summary, args.apply)
    if (summary.failed > 0) process.exitCode = 1
  } finally {
    await client.end({ timeout: 5 })
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[backfill] ${safeErrorMessage(error)}`)
    process.exitCode = 1
  })
}
