// @aether/web · Resonance Gateway 公共 HTTP 助手
// runHandler（未知异常兜底）/ readJsonBody / isResponse。
// 独立成模块供 resonance 与 webhooks 服务层共用，避免服务层互相 import 成环。
import { createLogger } from '@/lib/logger'
import { apiError } from './protocol'

/** unknown → Response 类型守卫：authorize / readJsonBody 等的联合返回收窄。 */
export function isResponse(value: unknown): value is Response {
  return value instanceof Response
}

/** 未知异常兜底：公开 API 一律 JSON 500，不让 Next 渲染 HTML 错误页。 */
export async function runHandler(
  scope: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const logger = createLogger('resonance:http')
  try {
    return await fn()
  } catch (error) {
    logger.error(scope, { error })
    return apiError(500, 'internal_error', 'Internal server error.')
  }
}

// 返回值：解析成功的 JSON（unknown），或解析失败的 400 Response；isResponse 负责收窄。
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return apiError(400, 'invalid_json', 'Request body must be valid JSON.')
  }
}
