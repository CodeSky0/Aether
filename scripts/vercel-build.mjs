// scripts/vercel-build.mjs
// Aether · Vercel 构建前迁移脚本（使用 Node.js 实现，跨平台兼容）
// 仅在生产环境执行数据库迁移（幂等，可安全重复运行）
import { execSync } from 'node:child_process'

const env = process.env.VERCEL_ENV || 'development'

if (env === 'production') {
  console.log('[migration] Running production migration...')
  try {
    execSync('pnpm --filter @aether/db db:migrate', { stdio: 'inherit' })
    console.log('[migration] Complete')
  } catch (err) {
    console.error('[migration] Failed:', err.message)
    process.exit(1)
  }
} else {
  console.log(`[migration] Skipped (env: ${env})`)
}
