// @aether/db · Drizzle Kit 配置
// schema 覆盖核心领域表与 @aether/auth 认证表，迁移统一输出到 ./drizzle。
// 说明：drizzle-kit 以 glob 匹配 schema 路径，@aether 目录名中的 @ 字符会被
// 当作 glob 特殊语法导致相对路径匹配失败，故使用绝对路径拼接。
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'drizzle-kit'

const authSchemaPath = fileURLToPath(
  new URL('../../@aether/auth/src/schema.ts', import.meta.url),
)

/**
 * 解析数据库连接 URL。
 * 优先级：
 *   1. DATABASE_URL_UNPOOLED   — 手工配置的直连地址
 *   2. POSTGRES_URL_NON_POOLING — Vercel Postgres 自动注入的直连地址（推荐）
 *   3. DATABASE_URL            — 通用连接地址
 *   4. POSTGRES_URL            — Vercel Postgres 自动注入的 pooled 地址
 *   5. AETHER_DATABASE_URL     — 回填脚本专用
 */
function resolveDatabaseUrl(): string {
  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.AETHER_DATABASE_URL
  if (!url) {
    throw new Error(
      '数据库连接未配置。请设置 DATABASE_URL、POSTGRES_URL_NON_POOLING 或 DATABASE_URL_UNPOOLED。',
    )
  }
  return url
}

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', authSchemaPath],
  out: './drizzle',
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
})
