// @aether/db · Drizzle Kit 配置
// schema 覆盖核心领域表与 @aether/auth 认证表，迁移统一输出到 ./drizzle。
// 说明：drizzle-kit 以 glob 匹配 schema 路径，@aether 目录名中的 @ 字符会被
// 当作 glob 特殊语法导致相对路径匹配失败，故使用绝对路径拼接。
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'drizzle-kit'

const authSchemaPath = fileURLToPath(
  new URL('../../@aether/auth/src/schema.ts', import.meta.url),
)

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', authSchemaPath],
  out: './drizzle',
  dbCredentials: {
    // Vercel 部署使用直连地址执行迁移；本地兼容历史变量。
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.AETHER_DATABASE_URL!,
  },
})
