// @aether/auth · 无会话用户目录操作（SCIM provisioning 等服务器到服务器场景）
// 直读写 Better-Auth user 表；封装在包内，下游不接触 better-auth 表结构。
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { user } from './schema.js'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { TablesRelationalConfig } from 'drizzle-orm'

/** Better-Auth user 记录的稳定子集（对下游屏蔽表结构）。 */
export interface AuthUserRecord {
  id: string
  name: string
  email: string
  emailVerified: boolean
  createdAt: Date
}

function toRecord(row: typeof user.$inferSelect): AuthUserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt,
  }
}

export async function findAuthUserByEmail<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  email: string,
): Promise<AuthUserRecord | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  return row ? toRecord(row) : null
}

export async function findAuthUserById<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  id: string,
): Promise<AuthUserRecord | null> {
  const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1)
  return row ? toRecord(row) : null
}

export interface CreateAuthUserInput {
  name: string
  email: string
  /** SCIM 用户来自 IdP 断言；本地密码登录不在其链路上。 */
  emailVerified?: boolean
}

/**
 * 创建 Better-Auth user（无凭据：无 password、无 account 行）。
 * email 撞唯一约束时由数据库抛错，调用方负责转 409。
 */
export async function createAuthUser<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  input: CreateAuthUserInput,
): Promise<AuthUserRecord> {
  const [row] = await db
    .insert(user)
    .values({
      id: randomUUID(),
      name: input.name,
      email: input.email,
      emailVerified: input.emailVerified ?? true,
    })
    .returning()
  if (!row) {
    throw new Error(`Failed to create auth user for ${input.email}`)
  }
  return toRecord(row)
}

/** 更新 user 的显示名（SCIM displayName replace）。 */
export async function updateAuthUserName<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  id: string,
  name: string,
): Promise<void> {
  await db.update(user).set({ name }).where(eq(user.id, id))
}
