// @aether/converge-server · Hocuspocus 实例工厂
// 独立进程入口（src/index.ts）使用此 Hocuspocus 配置。
// Cloudflare Workers 部署（cf/index.ts）使用独立的 Durable Object 实现，不依赖此工厂。
import { Hocuspocus, type Extension } from '@hocuspocus/server'
import { getDb } from './db.js'
import { AetherDatabaseExtension } from './extensions/database.js'
import { createRedisExtension } from './extensions/redis.js'
import {
  createConvergeMetrics,
  getConvergeMetrics,
  type ConvergeMetrics,
} from './telemetry.js'

export { Hocuspocus }

export interface HocuspocusFactoryOptions {
  /** 监听端口（仅独立进程模式使用，Vercel Function 不设置） */
  port?: number
  /** 绑定地址（仅独立进程模式使用） */
  address?: string
  /** Converge Telemetry 指标（可选；默认用全局单例，测试时可注入独立实例） */
  metrics?: ConvergeMetrics
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
  const metrics = options.metrics ?? getConvergeMetrics()
  const extensions: Extension[] = [
    new AetherDatabaseExtension({ db, metrics }),
  ]

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
      metrics.connectionsTotal.inc(1, { status: 'success' })
      if (process.env.LOG_LEVEL === 'debug') {
        // eslint-disable-next-line no-console
        console.log(`[converge-server] disconnect: ${data.documentName}`)
      }
      return Promise.resolve()
    },
  })
}

export { createConvergeMetrics }
