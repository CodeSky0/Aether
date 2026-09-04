// Resonance Gateway 鉴权层测试（lib/resonance/auth.ts）
// 覆盖：Bearer 解析、sha256 哈希查找、fail-closed 三重校验、last_used_at 维护。
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { getDb } from '@/lib/db'
import {
  parseBearerKey,
  resolveApiKey,
  touchLastUsed,
} from '@/lib/resonance/auth'

const mockedGetDb = vi.mocked(getDb)

const REALM_ID = '01234567-89ab-cdef-0123-456789abcdef'
const TOKEN = `aeth_${'k'.repeat(40)}`
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')

const keyRow = {
  keyId: 'key-1',
  keyName: 'CLI',
  creatorId: 'user-1',
  realmId: REALM_ID,
  realmSlug: 'alpha',
  realmName: 'Alpha',
  realmCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
  realmUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
}

const memberRow = { id: 'member-1' }

/** 从 drizzle SQL 条件对象中递归提取绑定参数值（Param 节点含 encoder + value）。 */
function collectSqlParams(node: unknown, out: unknown[] = []): unknown[] {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) collectSqlParams(item, out)
    return out
  }
  const record = node as Record<string, unknown>
  if ('encoder' in record && 'value' in record) {
    out.push(record.value)
    return out
  }
  if (Array.isArray(record.queryChunks)) {
    collectSqlParams(record.queryChunks, out)
  }
  return out
}

/** 可链式 mock：where(arg) 时由 handler 决定返回行；支持任意 drizzle 链形状。 */
function makeQuery(
  handleWhere: (arg: unknown) => unknown[],
): Record<string, unknown> {
  let promise = Promise.resolve([] as unknown[])
  const self: Record<string, unknown> = {
    innerJoin: () => self,
    orderBy: () => self,
    limit: () => self,
    offset: () => self,
    where: (arg: unknown) => {
      promise = Promise.resolve(handleWhere(arg))
      return self
    },
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  }
  return self
}

/**
 * 构造 getDb mock：按调用顺序消费 select handler。
 * keyHandler 收到 where 条件参数，验证其中包含 TOKEN_HASH（sha256 查找语义）。
 */
function mockAuthDb(options: {
  keyHandler?: (whereArg: unknown) => unknown[]
  memberRows?: unknown[]
}) {
  const keyHandler =
    options.keyHandler ??
    ((whereArg: unknown) => {
      const params = collectSqlParams(whereArg)
      return params.includes(TOKEN_HASH) ? [keyRow] : []
    })
  const handlers = [
    keyHandler,
    () => options.memberRows ?? [memberRow],
  ]
  let selectIndex = 0
  const db = {
    select: vi.fn(() => ({
      from: () => makeQuery(handlers[selectIndex++] ?? (() => [])),
    })),
    update: vi.fn(() => ({
      set: () => makeQuery(() => [keyRow]),
    })),
  }
  mockedGetDb.mockReturnValue(db as never)
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseBearerKey', () => {
  it('缺失 / 坏 scheme / 非 aeth 前缀 / 裸前缀均返回 null', () => {
    expect(parseBearerKey(null)).toBeNull()
    expect(parseBearerKey('Basic abc')).toBeNull()
    expect(parseBearerKey('Bearer not-aether-key')).toBeNull()
    expect(parseBearerKey('Bearer aeth_')).toBeNull()
  })

  it('合法 aeth 密钥原样返回', () => {
    expect(parseBearerKey(`Bearer ${TOKEN}`)).toBe(TOKEN)
    expect(parseBearerKey(`bearer ${TOKEN}`)).toBe(TOKEN)
  })
})

describe('resolveApiKey', () => {
  it('非 aeth 前缀密钥不触发任何数据库查询', async () => {
    const db = mockAuthDb({})
    const result = await resolveApiKey('Bearer unknown-token')
    expect(result).toBeNull()
    expect(db.select).not.toHaveBeenCalled()
  })

  it('有效密钥：按 sha256 哈希命中并返回完整上下文', async () => {
    mockAuthDb({})
    const result = await resolveApiKey(`Bearer ${TOKEN}`)
    expect(result).toEqual({
      keyId: 'key-1',
      keyName: 'CLI',
      creatorId: 'user-1',
      realm: {
        id: REALM_ID,
        slug: 'alpha',
        name: 'Alpha',
        created_at: keyRow.realmCreatedAt,
        updated_at: keyRow.realmUpdatedAt,
      },
    })
  })

  it('哈希不匹配（未知密钥）返回 null', async () => {
    mockAuthDb({})
    const result = await resolveApiKey(`Bearer aeth_${'other'.repeat(8)}`)
    expect(result).toBeNull()
  })

  it('创建者失去 active membership → fail-closed 返回 null', async () => {
    mockAuthDb({ memberRows: [] })
    const result = await resolveApiKey(`Bearer ${TOKEN}`)
    expect(result).toBeNull()
  })
})

describe('touchLastUsed', () => {
  it('按密钥 id 更新 last_used_at', async () => {
    const db = mockAuthDb({})
    await touchLastUsed('key-1')
    expect(db.update).toHaveBeenCalled()
  })

  it('更新失败仅记录日志，不向调用方抛错', async () => {
    const db = {
      select: vi.fn(),
      update: vi.fn(() => ({
        set: () =>
          makeQuery(() => {
            throw new Error('db down')
          }),
      })),
    }
    mockedGetDb.mockReturnValue(db as never)
    await expect(touchLastUsed('key-1')).resolves.toBeUndefined()
  })
})
