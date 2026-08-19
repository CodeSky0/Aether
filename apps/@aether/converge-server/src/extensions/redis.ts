// @aether/converge-server · Redis Extension Seam
// 多实例部署时用 Redis extension 同步 document updates 和 awareness。
// Vercel 多实例函数场景下，通过 REDIS_URL 启用（建议使用 Upstash Redis）。
// 支持 redis:// 与 rediss://（TLS，Upstash 默认协议）两种连接串。
import type { Extension } from '@hocuspocus/server'
import type { RedisOptions } from 'ioredis'

export interface RedisExtensionOptions {
  /** Redis 连接 URL（如 redis://localhost:6379 或 rediss://:token@host:port） */
  redisUrl: string
  /** 可选的 Redis 前缀，用于多租户隔离 */
  prefix?: string
}

interface ParsedRedisConfig {
  host: string
  port: number
  options: RedisOptions
}

function parseRedisUrl(url: string): ParsedRedisConfig {
  const parsed = new URL(url)
  const options: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
  }
  if (parsed.password) {
    options.password = decodeURIComponent(parsed.password)
  }
  if (parsed.username) {
    options.username = decodeURIComponent(parsed.username)
  }
  // Upstash 等托管 Redis 使用 TLS 协议（rediss://）
  if (parsed.protocol === 'rediss:') {
    options.tls = {}
  }
  return { host: options.host as string, port: options.port as number, options }
}

/**
 * 创建 Redis extension（如果可用）。
 *
 * 动态导入 @hocuspocus/extension-redis 以避免硬依赖。
 * 多实例部署时执行 `pnpm --filter @aether/converge-server add @hocuspocus/extension-redis`。
 */
export async function createRedisExtension(
  options: RedisExtensionOptions,
): Promise<Extension> {
  try {
    const mod = await import('@hocuspocus/extension-redis')
    const RedisExtension = (mod.Redis ?? mod.default) as
      | (new (options: {
          host: string
          port: number
          prefix: string
          options: RedisOptions
        }) => Extension)
      | undefined
    if (!RedisExtension) {
      // 配置了 REDIS_URL 但包不可用时 fail-fast，避免静默降级为单实例
      throw new Error('@hocuspocus/extension-redis module loaded but no Redis export found')
    }
    const { host, port, options: redisOptions } = parseRedisUrl(options.redisUrl)
    return new RedisExtension({
      host,
      port,
      prefix: options.prefix ?? 'aether:',
      options: redisOptions,
    })
  } catch (err) {
    // 配置了 REDIS_URL 但依赖缺失时抛出错误而非静默降级
    throw new Error(
      `[converge-server] REDIS_URL is configured but @hocuspocus/extension-redis is not available. ` +
        `Install it with: pnpm --filter @aether/converge-server add @hocuspocus/extension-redis. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
