import { describe, expect, it, vi } from 'vitest'
import type { AuthInstance } from '../src/instance.js'
import {
  createAuthUser,
  findAuthUserByEmail,
  findAuthUserById,
} from '../src/user-directory.js'
import {
  deleteOrganizationMember,
  provisionOrganizationMember,
} from '../src/organization.js'

function mockDb(row: Record<string, unknown> | null) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(row ? [row] : []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([row]),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(row ? [row] : []),
      })),
    })),
  }
}

const baseRow = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

describe('user-directory', () => {
  it('finds users by email and maps to the stable record shape', async () => {
    const db = mockDb(baseRow)
    const record = await findAuthUserByEmail(db as never, 'ada@example.com')
    expect(record).toEqual({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      createdAt: baseRow.createdAt,
    })
  })

  it('returns null when no user matches', async () => {
    const db = mockDb(null)
    await expect(
      findAuthUserById(db as never, 'missing'),
    ).resolves.toBeNull()
  })

  it('creates users with a generated id and emailVerified defaulting to true', async () => {
    const values = vi.fn((_payload: Record<string, unknown>) => ({
      returning: vi.fn().mockResolvedValue([baseRow]),
    }))
    const insert = vi.fn(() => ({ values }))
    const db = { insert } as never

    await createAuthUser(db, {
      name: 'Ada',
      email: 'ada@example.com',
    })

    const payload = values.mock.calls[0]?.[0]
    expect(payload).toMatchObject({
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
    })
    expect(payload?.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('scim organization wrappers', () => {
  it('provisions members via the addMember system action', async () => {
    const addMember = vi.fn().mockResolvedValue({ id: 'member-1' })
    const auth = { api: { addMember } } as unknown as AuthInstance

    await provisionOrganizationMember(auth, {
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'member',
    })

    expect(addMember).toHaveBeenCalledWith({
      body: {
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'member',
      },
    })
  })

  it('reports whether a member row was deleted', async () => {
    const hit = mockDb({ id: 'member-1' })
    const miss = mockDb(null)

    await expect(
      deleteOrganizationMember(hit as never, {
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).resolves.toBe(true)
    await expect(
      deleteOrganizationMember(miss as never, {
        organizationId: 'org-1',
        userId: 'user-2',
      }),
    ).resolves.toBe(false)
  })
})
