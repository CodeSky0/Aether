// @aether/web · 数据库实例单例
// 使用 postgres-js 驱动 + drizzle-orm/postgres-js 适配器创建 PgDatabase 实例。
// Server Actions 经此实例调用 @aether/db 的查询函数（appendCrdtUpdate 等）。
// 连接懒创建，Serverless 冷启动时首次调用才建连；复用全局单例避免每请求新建池。
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@aether/db/schema'

let dbInstance: ReturnType<typeof createDrizzle> | null = null

function getDatabaseUrl() {
  // Neon/Vercel may expose the same database under different integration keys.
  // Prefer the canonical key, then fall back to the injected Postgres aliases.
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL_UNPOOLED,
  ]

  return candidates.find((value) => value?.trim())?.trim() ?? null
}

export function isDatabaseConfigured() {
  return getDatabaseUrl() !== null
}

function createDrizzle() {
  const url = getDatabaseUrl()
  if (!url) {
    throw new Error(
      'No Postgres connection is configured. Set DATABASE_URL or POSTGRES_URL in the Vercel project environment.',
    )
  }

  // postgres-js 连接池：Serverless 场景下 max 连接数保守设置。
  const queryClient = postgres(url, { max: 10 })
  return drizzle(queryClient, { schema })
}

/** 获取全局 drizzle 实例（懒初始化单例）。 */
export function getDb() {
  if (!dbInstance) {
    dbInstance = createDrizzle()
  }
  return dbInstance
}
