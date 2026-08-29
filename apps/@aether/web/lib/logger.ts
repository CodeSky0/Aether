// @aether/web · 结构化日志（Step 6 Console Hygiene）
// 规则：服务端唯一日志出口；JSON 行格式便于 Vercel Log Drains / 采集器解析。
// debug 仅在开发环境输出；生产环境零 log/info/debug 噪音，只留 warn/error。
// 本文件是 no-console 的唯一豁免点，业务代码一律 import logger。
/* eslint-disable no-console -- 服务端结构化日志的唯一出口 */
type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogFields {
  [key: string]: unknown
}

/** Error 对象序列化（JSON.stringify(Error) 会丢 name/message/stack） */
function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'production'
        ? undefined
        : error.stack,
    }
  }
  return error
}

function emit(level: Level, scope: string, message: string, fields?: LogFields) {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return
  if (level === 'info' && process.env.NODE_ENV === 'production') return
  const serialized: LogFields = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    serialized[key] = value instanceof Error ? serializeError(value) : value
  }
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...serialized,
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, fields?: LogFields) =>
      emit('debug', scope, message, fields),
    info: (message: string, fields?: LogFields) =>
      emit('info', scope, message, fields),
    warn: (message: string, fields?: LogFields) =>
      emit('warn', scope, message, fields),
    error: (message: string, fields?: LogFields) =>
      emit('error', scope, message, fields),
  }
}
