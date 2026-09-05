// @aether/converge-server · Hocuspocus 收敛服务独立进程入口
// 本入口用于本地开发与自托管部署（长驻 Node 进程）。
// 生产部署请使用 Cloudflare Workers 入口（cf/index.ts，Durable Objects）。
//
// 启动方式：
//   pnpm --filter @aether/converge-server dev   (开发)
//   pnpm --filter @aether/converge-server start (生产)
//
// 环境变量：
//   PORT              - 监听端口（默认 1234）
//   DATABASE_URL      - Postgres 连接 URL（必需）
//   REDIS_URL         - Redis 连接 URL（可选，多实例广播）
import { createHocuspocus } from './hocuspocus.js'

const PORT = parseInt(process.env.PORT ?? '1234', 10)

async function main() {
  const server = await createHocuspocus({ port: PORT, address: '0.0.0.0' })
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
