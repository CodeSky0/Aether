// @aether/db · Realm 隔离守卫泛化实现
// 提供类型安全的跨表 Realm 隔离查询条件生成器。
// 所有带 realm_id 的表必须经此守卫生成查询条件，禁止手工拼接 realm_id。
import { and, eq, type SQL, type Table } from 'drizzle-orm'
import * as schema from './schema.js'
/** 支持 Realm 隔离的表清单 */
const REALM_TABLES = [
  'realms',
  'projects',
  'members',
  'entities',
  'threads',
  'currents',
  'crdt_updates',
  'audit_log',
  // P2-16 修复：dialogue_messages 表带 realm_id，纳入 Realm 隔离守卫
  'dialogue_messages',
  // Resonance：realm_integrations 带 realm_id，纳入 Realm 隔离守卫
  'realm_integrations',
] as const
type RealmTableName = (typeof REALM_TABLES)[number]
/** 获取表的符号名称（兼容 Drizzle 内部实现） */
function getTableName(table: Table): string {
  const symbolName = Symbol.for('drizzle:Name')
  const candidate = table as unknown as {
    [key: symbol]: unknown
    name?: unknown
  }
  const name = candidate[symbolName] ?? candidate.name
  return typeof name === 'string' ? name : ''
}
/**
 * 为指定表生成 Realm 隔离守卫条件
 * @param table - 目标表（必须是带 realm_id 的表）
 * @param realmId - Realm UUID
 * @returns SQL 查询条件
 * @throws Error 当表不支持 Realm 隔离或缺少 realm_id 字段时抛出
 *
 * @example
 * ```ts
 * import { db } from '@aether/db'
 * import { threads, realmGuard } from '@aether/db'
 *
 * const result = await db
 *   .select()
 *   .from(threads)
 *   .where(realmGuard(threads, realmId))
 * ```
 */
export function realmGuard(table: Table, realmId: string): SQL {
  const tableName = getTableName(table) as RealmTableName
  // realms 表特殊处理：直接比较 id
  if (tableName === 'realms') {
    return eq(schema.realms.id, realmId)
  }
  // 验证表是否在支持列表中
  if (!REALM_TABLES.includes(tableName)) {
    throw new Error(
      `Table "${tableName}" does not support realm isolation. ` +
        `Supported tables: ${REALM_TABLES.join(', ')}`
    )
  }
  // 获取 realm_id 列并生成条件
  const realmCol = (
    table as unknown as { realm_id?: Parameters<typeof eq>[0] }
  ).realm_id
  if (!realmCol) {
    throw new Error(
      `Table "${tableName}" is missing the "realm_id" column. ` +
        'All realm-scoped tables must have a realm_id foreign key.'
    )
  }
  return eq(realmCol, realmId)
}
/**
 * 组合多个查询条件并强制附加 Realm 隔离守卫
 * @param table - 目标表
 * @param realmId - Realm UUID
 * @param conditions - 其他查询条件（可选）
 * @returns 组合后的 SQL 条件
 *
 * @example
 * ```ts
 * const result = await db
 *   .select()
 *   .from(threads)
 *   .where(realmScope(threads, realmId, eq(threads.status, 'open')))
 * ```
 */
export function realmScope(
  table: Table,
  realmId: string,
  ...conditions: SQL[]
): SQL {
  const guard = realmGuard(table, realmId)
  if (conditions.length === 0) {
    return guard
  }
  return and(guard, ...conditions)!
}
