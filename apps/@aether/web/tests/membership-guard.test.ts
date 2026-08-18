import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { ensureRealmMembership } from '@/lib/membership-provisioning'
import {
  MANAGE_MEMBER_ROLES,
  READ_MEMBER_ROLES,
  requireRealmRole,
} from '@/lib/membership-guard'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/membership-provisioning', () => ({
  ensureRealmMembership: vi.fn(),
}))

const mockedGetDb = vi.mocked(getDb)
const actor = { actorType: 'human', actorId: 'user-1' } as const

function mockMembership(rows: { role: string }[]) {
  mockedGetDb.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(rows),
        })),
      })),
    })),
  } as never)
}

describe('requireRealmRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 开关关闭（默认值）时守卫仍必须生效。
    delete process.env.AETHER_ENTITLEMENT_ENABLED
  })

  it('mirrors Better-Auth membership before reading the Aether role', async () => {
    mockMembership([{ role: 'owner' }])

    await expect(
      requireRealmRole('realm-1', actor, MANAGE_MEMBER_ROLES),
    ).resolves.toBe('owner')
    expect(vi.mocked(ensureRealmMembership)).toHaveBeenCalledWith({
      realmId: 'realm-1',
      actorType: 'human',
      actorId: 'user-1',
    })
  })

  it('denies actors without an active Realm membership', async () => {
    mockMembership([])

    await expect(
      requireRealmRole('realm-1', actor, READ_MEMBER_ROLES),
    ).rejects.toThrow('does not permit this operation')
  })

  it('denies members whose role is outside the allowed set', async () => {
    mockMembership([{ role: 'member' }])

    await expect(
      requireRealmRole('realm-1', actor, MANAGE_MEMBER_ROLES),
    ).rejects.toThrow('does not permit this operation')
  })
})
