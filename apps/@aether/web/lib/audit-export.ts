// @aether/web · Audit Vault 导出：查询参数解析与 CSV / JSONL 序列化
// 纯函数 + 异步游标，不含 'use server'，供 Route Handler 流式导出复用。
import { auditLog } from '@aether/db'
import { and, asc, eq, gt, gte, lte, or, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { ActorType, AuditAction } from '@aether/types'

export const AUDIT_EXPORT_FORMATS = ['csv', 'jsonl'] as const
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number]

const ACTOR_TYPES: readonly string[] = ['human', 'entity']
const AUDIT_ACTIONS: readonly string[] = [
  'read',
  'write',
  'permission_change',
  'converse',
  'execute',
]

/** 单页游标步长：导出总量不设上限，按页拉取以限制内存占用。 */
export const AUDIT_EXPORT_PAGE_SIZE = 500

export interface AuditExportQuery {
  format: AuditExportFormat
  actorType?: ActorType
  action?: AuditAction
  from?: Date
  to?: Date
}

export class AuditExportQueryError extends Error {}

function parseDate(value: string, label: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new AuditExportQueryError(`Invalid ${label} timestamp: ${value}`)
  }
  return parsed
}

/**
 * 解析导出查询串，非法取值直接报错而不是静默忽略——
 * 导出结果会被当作合规证据，过滤条件被吞掉会给出错误的完整性印象。
 */
export function parseAuditExportQuery(
  searchParams: URLSearchParams,
): AuditExportQuery {
  const format = searchParams.get('format') ?? 'csv'
  if (!AUDIT_EXPORT_FORMATS.includes(format as AuditExportFormat)) {
    throw new AuditExportQueryError(
      `Unsupported export format: ${format}; expected csv or jsonl`,
    )
  }
  const query: AuditExportQuery = { format: format as AuditExportFormat }

  const actorType = searchParams.get('actorType')
  if (actorType !== null && actorType !== '') {
    if (!ACTOR_TYPES.includes(actorType)) {
      throw new AuditExportQueryError(`Unsupported actorType: ${actorType}`)
    }
    query.actorType = actorType as ActorType
  }

  const action = searchParams.get('action')
  if (action !== null && action !== '') {
    if (!AUDIT_ACTIONS.includes(action)) {
      throw new AuditExportQueryError(`Unsupported action: ${action}`)
    }
    query.action = action as AuditAction
  }

  const from = searchParams.get('from')
  if (from !== null && from !== '') query.from = parseDate(from, 'from')
  const to = searchParams.get('to')
  if (to !== null && to !== '') query.to = parseDate(to, 'to')
  if (query.from && query.to && query.from > query.to) {
    throw new AuditExportQueryError('from must not be later than to')
  }
  return query
}

export interface AuditExportRow {
  id: string
  realm_id: string
  actor_type: ActorType
  actor_id: string
  action: AuditAction
  target: unknown
  payload_hash: string
  idempotency_key: string
  result: unknown
  created_at: Date
}

export const AUDIT_EXPORT_COLUMNS = [
  'id',
  'realm_id',
  'actor_type',
  'actor_id',
  'action',
  'target',
  'payload_hash',
  'idempotency_key',
  'result',
  'created_at',
] as const

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString()
  }
  return JSON.stringify(value)
}

function csvCell(value: unknown): string {
  const text = cellText(value)
  // 公式注入防护：以 = + - @ 开头的单元格在表格软件里会被当作公式执行。
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${guarded.replaceAll('"', '""')}"`
}

export function auditCsvHeader(): string {
  return `${AUDIT_EXPORT_COLUMNS.join(',')}\n`
}

export function auditCsvLine(row: AuditExportRow): string {
  return `${AUDIT_EXPORT_COLUMNS.map((column) => csvCell(row[column])).join(',')}\n`
}

export function auditJsonlLine(row: AuditExportRow): string {
  return `${JSON.stringify({
    ...row,
    created_at: row.created_at.toISOString(),
  })}\n`
}

export function auditExportFilename(
  realmSlug: string,
  format: AuditExportFormat,
  now: Date,
): string {
  const stamp = now.toISOString().replaceAll(/[:.]/g, '-')
  const slug = realmSlug.replaceAll(/[^a-zA-Z0-9-_]/g, '-')
  return `aether-audit-${slug}-${stamp}.${format}`
}

/**
 * 按 (created_at, id) 键集游标升序分页读取审计记录。
 * 用键集而不是 OFFSET：导出期间仍有新记录写入，OFFSET 分页会漏记录或重复记录。
 */
export async function* iterateAuditExportRows(
  realmId: string,
  query: AuditExportQuery,
  pageSize = AUDIT_EXPORT_PAGE_SIZE,
): AsyncGenerator<AuditExportRow> {
  const db = getDb()
  let cursor: { createdAt: Date; id: string } | null = null

  for (;;) {
    const conditions: SQL[] = [eq(auditLog.realm_id, realmId)]
    if (query.actorType) {
      conditions.push(eq(auditLog.actor_type, query.actorType))
    }
    if (query.action) conditions.push(eq(auditLog.action, query.action))
    if (query.from) conditions.push(gte(auditLog.created_at, query.from))
    if (query.to) conditions.push(lte(auditLog.created_at, query.to))
    if (cursor !== null) {
      const keyset = or(
        gt(auditLog.created_at, cursor.createdAt),
        and(
          eq(auditLog.created_at, cursor.createdAt),
          gt(auditLog.id, cursor.id),
        ),
      )
      if (keyset !== undefined) conditions.push(keyset)
    }

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(asc(auditLog.created_at), asc(auditLog.id))
      .limit(pageSize)

    for (const row of rows) yield row
    if (rows.length < pageSize) return
    const last = rows[rows.length - 1]
    if (last === undefined) return
    cursor = { createdAt: last.created_at, id: last.id }
  }
}
