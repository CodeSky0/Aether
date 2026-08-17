// @aether/converge-server · Hocuspocus 收敛服务入口
// 探测文档推荐形态：Node.js Hocuspocus + Postgres 持久化 + Redis 广播 seam。
// 这是 The Current 的权威实时通道；Server Actions 是降级非权威通道。
//
// 启动方式：
//   pnpm --filter @aether/converge-server dev   (开发)
//   pnpm --filter @aether/converge-server start (生产)
//
// 环境变量：
//   PORT              - 监听端口（默认 1234）
//   DATABASE_URL      - Postgres 连接 URL（必需）
//   REDIS_URL         - Redis 连接 URL（可选，多实例广播）
import type { Extension } from '@hocuspocus/server'
import { Hocuspocus } from '@hocuspocus/server'
import { getDb } from './db.js'
import { AetherDatabaseExtension } from './extensions/database.js'
import { createRedisExtension } from './extensions/redis.js'
const PORT = parseInt(process.env.PORT ?? '1234', 10)
const REDIS_URL = process.env.REDIS_URL
async function main() {
  const db = getDb()
  const extensions: Extension[] = []
  // Database extension: 接入 @aether/db crdt_updates 表
  extensions.push(new AetherDatabaseExtension({ db }))
  // Redis extension: 多实例广播 seam（可选）
  // P2-15 修复：配置了 REDIS_URL 但依赖缺失时 createRedisExtension 会 throw，
  // 由 main().catch() 捕获并退出，避免静默降级为单实例模式。
  if (REDIS_URL) {
    const redisExt = await createRedisExtension({ redisUrl: REDIS_URL })
    if (redisExt) {
      extensions.push(redisExt)
    }
    // eslint-disable-next-line no-console
    console.log('[converge-server] Redis extension enabled for multi-instance broadcast.')
  }
  const server = new Hocuspocus({
    name: 'aether-converge',
    port: PORT,
    address: '0.0.0.0',
    timeout: 30_000,
    debounce: 2_000,
    maxDebounce: 10_000,
    quiet: false,
    extensions,
    onListen() {
      // eslint-disable-next-line no-console
      console.log(`[converge-server] Hocuspocus listening on :${PORT}`)
      return Promise.resolve()
    },
    onDisconnect(data) {
      // M1 阶段仅日志；后续可在此清理 presence 或触发审计
      if (process.env.LOG_LEVEL === 'debug') {
        // eslint-disable-next-line no-console
        console.log(`[converge-server] disconnect: ${data.documentName}`)
      }
      return Promise.resolve()
    },
  })
  // 优雅关闭
  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[converge-server] Shutting down...')
    await server.destroy()
    process.exit(0)
  }
  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })
  await server.listen()
}
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[converge-server] Fatal error:', err)
  process.exit(1)
})
