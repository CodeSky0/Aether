import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureRealmMembership } from '@/lib/membership-provisioning'
import { findOrganizationMemberRoles } from '@aether/auth'
import { getDb } from '@/lib/db'

vi.mock('@aether/auth', () => ({
  findOrganizationMemberRoles: vi.fn(),
  isPlaceholderOrganization: (id: string) =>
    id.startsWith('org-placeholder-'),
}))

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/audit-write', () => ({
  recordPermissionChange: vi.fn(),
}))

const mockedFindRoles = vi.mocked(findOrganizationMemberRoles)
const mockedGetDb = vi.mocked(getDb)

function createSelectQueue(results: unknown[][]) {
  let index = 0
  return vi.fn(() => {
    const result = results[index] ?? []
    index += 1
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(result),
        })),
      })),
    }
  })
}

describe('ensureRealmMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns on the active membership fast path without querying Better-Auth', async () => {
    const select = createSelectQueue([[{ id: 'membership-1' }]])
    mockedGetDb.mockReturnValue({ select } as never)

    await ensureRealmMembership({
      realmId: 'realm-1',
      actorType: 'human',
      actorId: 'user-1',
    })

    expect(mockedFindRoles).not.toHaveBeenCalled()
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('mirrors multi-roles as one membership with the highest role', async () => {
    const select = createSelectQueue([[], [{ authOrgId: 'org-1' }]])
    let insertedRole: string | undefined
    const db = {
      select,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: vi.fn(() => {
            return {
              values: vi.fn((values: { role?: string }) => {
                insertedRole = values.role
                return {
                  onConflictDoNothing: vi.fn(() => ({
                    returning: vi.fn().mockResolvedValue([{ id: 'membership-1' }]),
                  })),
                }
              }),
            }
          }),
        }
        await callback(tx)
      }),
    }
    mockedGetDb.mockReturnValue(db as never)
    mockedFindRoles.mockResolvedValue(['member', 'owner', 'admin'])

    await ensureRealmMembership({
      realmId: 'realm-1',
      actorType: 'human',
      actorId: 'user-1',
    })

    expect(mockedFindRoles).toHaveBeenCalledWith(db, {
      organizationId: 'org-1',
      userId: 'user-1',
    })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(insertedRole).toBe('owner')
  })

  it('does not write when the organization member is not found', async () => {
    const select = createSelectQueue([[], [{ authOrgId: 'org-1' }]])
    const transaction = vi.fn()
    mockedGetDb.mockReturnValue({ select, transaction } as never)
    mockedFindRoles.mockResolvedValue([])

    await ensureRealmMembership({
      realmId: 'realm-1',
      actorType: 'human',
      actorId: 'user-1',
    })

    expect(transaction).not.toHaveBeenCalled()
  })

  it('skips unknown roles and warns once', async () => {
    const select = createSelectQueue([[], [{ authOrgId: 'org-1' }]])
    const transaction = vi.fn()
    mockedGetDb.mockReturnValue({ select, transaction } as never)
    mockedFindRoles.mockResolvedValue(['unknown-role'])
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await ensureRealmMembership({
      realmId: 'realm-1',
      actorType: 'human',
      actorId: 'user-1',
    })
    await ensureRealmMembership({
      realmId: 'realm-1',
      actorType: 'human',
      actorId: 'user-1',
    })

    expect(warning).toHaveBeenCalledTimes(1)
    expect(transaction).not.toHaveBeenCalled()
    warning.mockRestore()
  })

  it('is a no-op for placeholder organizations', async () => {
    const select = createSelectQueue([[], [{ authOrgId: 'org-placeholder-1' }]])
    const transaction = vi.fn()
    mockedGetDb.mockReturnValue({ select, transaction } as never)

    await ensureRealmMembership({
      realmId: 'realm-1',
      actorType: 'human',
      actorId: 'user-1',
    })

    expect(mockedFindRoles).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})
