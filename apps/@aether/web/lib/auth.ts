// @aether/web · Better-Auth 单例
// Web 只经 @aether/auth 使用 Better-Auth，不直接依赖其实现包。
import { createAuth, type AuthInstance } from '@aether/auth'
import { getDb } from '@/lib/db'

let authInstance: AuthInstance | null = null

function createWebAuth(): AuthInstance {
  const baseURL = process.env.BETTER_AUTH_URL
  if (!baseURL) {
    throw new Error(
      'BETTER_AUTH_URL is not set. Better-Auth requires an application base URL.',
    )
  }
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not set. Better-Auth requires an explicit secret.',
    )
  }

  return createAuth({
    db: getDb(),
    baseURL,
    secret,
    options: {
      emailAndPassword: {
        enabled: true,
      },
    },
  })
}

/** 获取 Web 进程内共享的 Better-Auth 实例。 */
export function getAuth(): AuthInstance {
  if (!authInstance) {
    authInstance = createWebAuth()
  }
  return authInstance
}

/**
 * 尝试获取 Web Better-Auth 实例。
 * 认证环境变量未配置时返回 null，供非认证开发路径优雅降级。
 */
export function tryGetAuth(): AuthInstance | null {
  if (!process.env.BETTER_AUTH_URL || !process.env.BETTER_AUTH_SECRET) {
    return null
  }
  return getAuth()
}
