import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRealm } from '@/lib/realms'
import { createRealmOrganization } from '@aether/auth'
import { getDb } from '@/lib/db'
import { tryGetAuth } from '@/lib/auth'
import { resolveCurrentActor } from '@/lib/auth-guard'

vi.mock('@aether/auth', () => ({
  createRealmOrganization: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  tryGetAuth: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({
  resolveCurrentActor: vi.fn(),
}))

vi.mock('@/lib/audit-write', () => ({
  recordPermissionChange: vi.fn(),
}))

const mockedCreateOrganization = vi.mocked(createRealmOrganization)
const mockedGetDb = vi.mocked(getDb)
const mockedTryGetAuth = vi.mocked(tryGetAuth)
const mockedResolveActor = vi.mocked(resolveCurrentActor)

function returningInsert(result: unknown[]) {
  return {
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(result),
    })),
  }
}

describe('createRealm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateOrganization.mockResolvedValue({ id: 'org-1' } as never)
    mockedResolveActor.mockResolvedValue({
      actorType: 'human',
      actorId: 'user-1',
    })
  })

  it('keeps placeholder behavior without configured auth', async () => {
    mockedTryGetAuth.mockReturnValue(null)
    const insert = vi.fn(() =>
      returningInsert([
        { id: 'realm-1', slug: 'demo', name: 'Demo' },
      ]),
    )
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ insert }),
    )
    mockedGetDb.mockReturnValue({ transaction } as never)

    const result = await createRealm({ slug: 'demo', name: 'Demo' })

    expect(result).toMatchObject({
      success: true,
      data: { id: 'realm-1', slug: 'demo', name: 'Demo' },
    })
    expect(mockedResolveActor).not.toHaveBeenCalled()
    expect(mockedCreateOrganization).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledTimes(1)
    // realm + 本地 owner 成员 + 默认 project + 种子 entity
    expect(insert).toHaveBeenCalledTimes(4)
  })

  it('binds a configured session to an organization and owner membership', async () => {
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              { id: 'realm-1', slug: 'demo', name: 'Demo' },
            ]),
          })),
        })),
      }),
    )
    mockedTryGetAuth.mockReturnValue({} as NonNullable<ReturnType<typeof tryGetAuth>>)
    mockedGetDb.mockReturnValue({ transaction } as never)

    const result = await createRealm({ slug: 'demo', name: 'Demo' })

    expect(result.success).toBe(true)
    expect(mockedCreateOrganization).toHaveBeenCalledWith(
      expect.anything(),
      { name: 'Demo', slug: 'demo', ownerUserId: 'user-1' },
    )
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('does not write a Realm when organization creation fails', async () => {
    mockedTryGetAuth.mockReturnValue({} as NonNullable<ReturnType<typeof tryGetAuth>>)
    mockedCreateOrganization.mockRejectedValue(new Error('organization failed'))
    const transaction = vi.fn()
    mockedGetDb.mockReturnValue({ transaction } as never)

    const result = await createRealm({ slug: 'demo', name: 'Demo' })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('organization failed')
    expect(transaction).not.toHaveBeenCalled()
  })
})
