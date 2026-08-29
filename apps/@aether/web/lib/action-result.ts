// @aether/web · Server Action 统一返回契约与输入校验工具
// 规则（Production-Grade 约定）：
//   1. 每个 Server Action 的入参先过 zod 校验；
//   2. 返回值一律为 ActionResult，客户端永不接收裸异常；
//   3. 异常在服务端收敛成可展示文案，并经结构化 logger 留痕排查。
// 注意：本文件不是 'use server' 模块（不能导出非 async 值），
// 由各 Action 文件按需 import。
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const logger = createLogger('action')

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

/** 把未知异常收敛为可展示的错误文案（zod 校验失败给字段级提示）。 */
export function toActionError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'input'
        return `${field}: ${issue.message}`
      })
      .join('; ')
  }
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试。'
}

/**
 * 统一异常包装：Server Action 的执行体套这一层，
 * 任何 throw 都会被捕获并转换为 ActionResult，不再逃逸到客户端。
 */
export async function runGuarded<T>(
  scope: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return ok(await fn())
  } catch (error) {
    logger.error(scope, { error })
    return fail(toActionError(error))
  }
}

/** RSC 端解包：失败即抛（交给路由层错误处理）。 */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.success) return result.data
  throw new Error(result.error)
}

/** RSC 端解包：失败回退（保持只读页面在预览/降级环境不崩）。 */
export function unwrapOr<T>(result: ActionResult<T>, fallback: T): T {
  if (result.success) return result.data
  logger.warn('unwrapOr fallback', { error: result.error })
  return fallback
}

// ---- 公共 zod 字段 ----
// 与 lib/realms.ts 的 UUID_REGEX、@aether/types 的 UUIDSchema 同构。
export const uuidField = z.uuid('必须是合法 UUID')
export const realmIdField = uuidField
