// @aether/converge-server · Hocuspocus 实例工厂
// 独立进程入口（src/index.ts）与 Vercel Function 入口（src/vercel.ts）
// 共享同一套 Hocuspocus 配置，避免两份配置漂移。
import { Hocuspocus, type Extension } from '@hocuspocus/server'
import { getDb } from './db.js'
import { AetherDatabaseExtension } from './extensions/database.js'
import { createRedisExtension } from './extensions/redis.js'

export { Hocuspocus }

export interface HocuspocusFactoryOptions {
  /** 监听端口（仅独立进程模式使用，Vercel Function 不设置） */
  port?: number
  /** 绑定地址（仅独立进程模式使用） */
  address?: string
}

/**
 * 创建配置完整的 Hocuspocus 实例。
 *
 * - Database extension：@aether/db crdt_updates 表持久化（始终启用）
 * - Redis extension：多实例广播（配置 REDIS_URL 时启用，Vercel 多实例必配）
 *
 * 注意：Vercel Function 场景下实例随函数实例（instance）存活，
 * 每个函数实例共享同一份 Hocuspocus 状态。
 */
export async function createHocuspocus(
  options: HocuspocusFactoryOptions = {},
): Promise<Hocuspocus> {
  const db = getDb()
  const extensions: Extension[] = [new AetherDatabaseExtension({ db })]

  if (process.env.REDIS_URL) {
    const redisExt = await createRedisExtension({ redisUrl: process.env.REDIS_URL })
    extensions.push(redisExt)
    // eslint-disable-next-line no-console
    console.log('[converge-server] Redis extension enabled for multi-instance broadcast.')
  }

  return new Hocuspocus({
    name: 'aether-converge',
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.address !== undefined ? { address: options.address } : {}),
    timeout: 30_000,
    debounce: 2_000,
    maxDebounce: 10_000,
    quiet: false,
    extensions,
    onListen() {
      // eslint-disable-next-line no-console
      console.log(`[converge-server] Hocuspocus listening on :${options.port}`)
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
}
