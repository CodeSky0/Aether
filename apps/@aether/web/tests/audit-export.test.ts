import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import {
  auditCsvHeader,
  auditCsvLine,
  auditExportFilename,
  auditJsonlLine,
  AuditExportQueryError,
  iterateAuditExportRows,
  parseAuditExportQuery,
  type AuditExportRow,
} from '@/lib/audit-export'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

const row: AuditExportRow = {
  id: 'audit-1',
  realm_id: 'realm-1',
  actor_type: 'human',
  actor_id: 'user-1',
  action: 'write',
  target: { doc_ref: 'thread-1' },
  payload_hash: 'a'.repeat(64),
  idempotency_key: 'key-1',
  result: {},
  created_at: new Date('2026-08-18T00:00:00.000Z'),
}

describe('parseAuditExportQuery', () => {
  it('defaults to csv and keeps supported filters', () => {
    const query = parseAuditExportQuery(
      new URLSearchParams({
        actorType: 'entity',
        action: 'permission_change',
        from: '2026-08-01T00:00:00Z',
      }),
    )

    expect(query).toMatchObject({
      format: 'csv',
      actorType: 'entity',
      action: 'permission_change',
    })
    expect(query.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('rejects unsupported formats, filters and inverted ranges', () => {
    for (const params of [
      { format: 'xlsx' },
      { actorType: 'robot' },
      { action: 'drop' },
      { from: 'not-a-date' },
      { from: '2026-08-02T00:00:00Z', to: '2026-08-01T00:00:00Z' },
    ]) {
      expect(() =>
        parseAuditExportQuery(new URLSearchParams(params)),
      ).toThrow(AuditExportQueryError)
    }
  })
})

describe('audit serialization', () => {
  it('quotes CSV cells, serializes JSON columns and neutralizes formulas', () => {
    const line = auditCsvLine({
      ...row,
      actor_id: '=cmd|"/c calc"!A1',
    })

    expect(auditCsvHeader()).toBe(
      'id,realm_id,actor_type,actor_id,action,target,payload_hash,idempotency_key,result,created_at\n',
    )
    expect(line).toContain('"\'=cmd|""/c calc""!A1"')
    expect(line).toContain('"{""doc_ref"":""thread-1""}"')
    expect(line).toContain('"2026-08-18T00:00:00.000Z"')
  })

  it('emits one JSON object per JSONL line with an ISO timestamp', () => {
    const parsed = JSON.parse(auditJsonlLine(row)) as Record<string, unknown>

    expect(auditJsonlLine(row).endsWith('\n')).toBe(true)
    expect(parsed.created_at).toBe('2026-08-18T00:00:00.000Z')
    expect(parsed.payload_hash).toBe(row.payload_hash)
  })

  it('builds a filesystem-safe filename', () => {
    expect(
      auditExportFilename('阿/尔法 realm', 'jsonl', new Date('2026-08-18T09:30:00Z')),
    ).toBe('aether-audit------realm-2026-08-18T09-30-00-000Z.jsonl')
  })
})

describe('iterateAuditExportRows', () => {
  function mockPages(pages: AuditExportRow[][]) {
    const limit = vi.fn()
    for (const page of pages) limit.mockResolvedValueOnce(page)
    mockedGetDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit })),
          })),
        })),
      })),
    } as never)
    return limit
  }

  const mockedGetDb = vi.mocked(getDb)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pages with a keyset cursor until a short page arrives', async () => {
    const second: AuditExportRow = { ...row, id: 'audit-2' }
    const limit = mockPages([[row, second], [{ ...row, id: 'audit-3' }]])

    const collected: string[] = []
    for await (const emitted of iterateAuditExportRows(
      'realm-1',
      { format: 'csv' },
      2,
    )) {
      collected.push(emitted.id)
    }

    expect(collected).toEqual(['audit-1', 'audit-2', 'audit-3'])
    expect(limit).toHaveBeenCalledTimes(2)
    expect(limit).toHaveBeenCalledWith(2)
  })

  it('stops after a single short page', async () => {
    const limit = mockPages([[row]])

    const collected: string[] = []
    for await (const emitted of iterateAuditExportRows(
      'realm-1',
      { format: 'jsonl' },
      500,
    )) {
      collected.push(emitted.id)
    }

    expect(collected).toEqual(['audit-1'])
    expect(limit).toHaveBeenCalledTimes(1)
  })
})
