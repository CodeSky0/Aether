import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthInstance } from '@aether/auth'
import { getDb } from '@/lib/db'
import { tryGetAuth } from '@/lib/auth'
import { recordPermissionChange } from '@/lib/audit-write'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  tryGetAuth: vi.fn(),
}))

vi.mock('@/lib/audit-write', () => ({
  recordPermissionChange: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@aether/auth', () => ({
  createAuthUser: vi.fn(),
  deleteOrganizationMember: vi.fn(),
  findAuthUserByEmail: vi.fn(),
  findAuthUserById: vi.fn(),
  findOrganizationMemberRoles: vi.fn(),
  isPlaceholderOrganization: (id: string) =>
    id.startsWith('org-placeholder-'),
  listOrganizationMembers: vi.fn(),
  provisionOrganizationMember: vi.fn(),
  updateAuthUserName: vi.fn(),
}))

import {
  createAuthUser,
  deleteOrganizationMember,
  findAuthUserByEmail,
  findAuthUserById,
  findOrganizationMemberRoles,
  listOrganizationMembers,
  provisionOrganizationMember,
} from '@aether/auth'
import {
  handleCreateUser,
  handleDeleteUser,
  handleGetUser,
  handleListUsers,
  handlePatchUser,
  handleServiceProviderConfig,
} from '@/lib/scim/service'

const TOKEN = 'scim-token-0123456789abcdef'
const REALM_ID = '01234567-89ab-cdef-0123-456789abcdef'
const ORG_ID = 'org-real-1'

const mockedGetDb = vi.mocked(getDb)
const mockedTryGetAuth = vi.mocked(tryGetAuth)

function scimRequest(
  path: string,
  init: RequestInit = {},
  token = TOKEN,
): Request {
  return new Request(`https://aether.example${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
}

const realmRow = [{ authOrgId: ORG_ID }]

function mockDb(options?: {
  realmRows?: { authOrgId: string }[]
  tx?: Record<string, unknown>
}) {
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'member-row' }]),
      })),
    })),
  }))
  const remove = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: 'member-row' }]),
    })),
  }))
  const tx = options?.tx ?? { insert, delete: remove }
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(options?.realmRows ?? realmRow),
        })),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
    insert,
    delete: remove,
    update: vi.fn(),
    execute: vi.fn(),
  }
  mockedGetDb.mockReturnValue(db as never)
  return { db, insert, remove }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AETHER_SCIM_TOKEN = TOKEN
  process.env.AETHER_SCIM_REALM_ID = REALM_ID
  process.env.BETTER_AUTH_URL = 'https://aether.example'
  process.env.BETTER_AUTH_SECRET = 'secret'
  mockedTryGetAuth.mockReturnValue({} as unknown as AuthInstance)
})

describe('scim service · guards', () => {
  it('returns 404 when SCIM is not configured', async () => {
    delete process.env.AETHER_SCIM_TOKEN
    delete process.env.AETHER_SCIM_REALM_ID

    const response = await handleListUsers(scimRequest('/api/scim/v2/Users'))
    expect(response.status).toBe(404)
  })

  it('returns 500 with a readable detail for partial configuration', async () => {
    delete process.env.AETHER_SCIM_REALM_ID

    const response = await handleListUsers(scimRequest('/api/scim/v2/Users'))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string }
    expect(body.detail).toMatch(/must be set together/)
  })

  it('rejects invalid bearer tokens with 401 and WWW-Authenticate', async () => {
    const response = await handleListUsers(
      scimRequest('/api/scim/v2/Users', {}, 'wrong-token-aaaaaaaaaa'),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
  })

  it('rejects missing bearer tokens', async () => {
    const response = await handleListUsers(
      scimRequest('/api/scim/v2/Users', {}, ''),
    )
    expect(response.status).toBe(401)
  })

  it('returns 500 when the realm does not exist', async () => {
    mockDb({ realmRows: [] })
    const response = await handleListUsers(scimRequest('/api/scim/v2/Users'))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string }
    expect(body.detail).toMatch(/does not exist/)
  })

  it('returns 500 when the realm is bound to a placeholder organization', async () => {
    mockDb({ realmRows: [{ authOrgId: 'org-placeholder-1' }] })
    const response = await handleListUsers(scimRequest('/api/scim/v2/Users'))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string }
    expect(body.detail).toMatch(/not bound/)
  })
})

describe('scim service · ServiceProviderConfig', () => {
  it('declares patch and filter support', async () => {
    const response = await handleServiceProviderConfig(
      scimRequest('/api/scim/v2/ServiceProviderConfig'),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      patch: { supported: boolean }
      filter: { supported: boolean }
      listEndpoint: string
    }
    expect(body.patch.supported).toBe(true)
    expect(body.filter.supported).toBe(true)
    expect(body.listEndpoint).toBe('https://aether.example/api/scim/v2/Users')
  })

  it('requires a valid bearer token', async () => {
    const response = await handleServiceProviderConfig(
      scimRequest('/api/scim/v2/ServiceProviderConfig', {}, 'nope-nope-nope'),
    )
    expect(response.status).toBe(401)
  })
})

describe('scim service · users', () => {
  it('lists organization members with pagination', async () => {
    mockDb()
    vi.mocked(listOrganizationMembers).mockResolvedValue([
      {
        userId: 'user-1',
        role: 'member',
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        userId: 'user-2',
        role: 'member',
        name: 'Bob',
        email: 'bob@example.com',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ])

    const response = await handleListUsers(
      scimRequest('/api/scim/v2/Users?startIndex=2&count=1'),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      totalResults: number
      itemsPerPage: number
      Resources: { id: string }[]
    }
    expect(body.totalResults).toBe(2)
    expect(body.itemsPerPage).toBe(1)
    expect(body.Resources).toHaveLength(1)
    expect(body.Resources[0]?.id).toBe('user-2')
  })

  it('applies a userName eq filter', async () => {
    mockDb()
    vi.mocked(listOrganizationMembers).mockResolvedValue([
      {
        userId: 'user-1',
        role: 'member',
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: new Date(),
      },
    ])

    const response = await handleListUsers(
      scimRequest(
        '/api/scim/v2/Users?filter=' +
          encodeURIComponent('userName eq "ada@example.com"'),
      ),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      totalResults: number
      Resources: { id: string }[]
    }
    expect(body.totalResults).toBe(1)
    expect(body.Resources[0]?.id).toBe('user-1')
  })

  it('rejects unsupported filters with 400', async () => {
    mockDb()
    const response = await handleListUsers(
      scimRequest(
        '/api/scim/v2/Users?filter=' +
          encodeURIComponent('emails.value eq "a@b.c"'),
      ),
    )
    expect(response.status).toBe(400)
  })

  it('creates a user, provisions membership, and audits', async () => {
    const { insert } = mockDb()
    vi.mocked(findAuthUserByEmail).mockResolvedValue(null)
    vi.mocked(createAuthUser).mockResolvedValue({
      id: 'user-new',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })

    const response = await handleCreateUser(
      scimRequest('/api/scim/v2/Users', {
        method: 'POST',
        body: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'ada@example.com',
          displayName: 'Ada',
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(createAuthUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Ada', email: 'ada@example.com' }),
    )
    expect(provisionOrganizationMember).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ORG_ID, userId: 'user-new', role: 'member' },
    )
    expect(insert).toHaveBeenCalled()
    expect(recordPermissionChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `scim:provision:${REALM_ID}:user-new`,
      }),
    )
    const body = (await response.json()) as { id: string; active: boolean }
    expect(body.id).toBe('user-new')
    expect(body.active).toBe(true)
  })

  it('conflicts when the userName already exists', async () => {
    mockDb()
    vi.mocked(findAuthUserByEmail).mockResolvedValue({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      createdAt: new Date(),
    })

    const response = await handleCreateUser(
      scimRequest('/api/scim/v2/Users', {
        method: 'POST',
        body: JSON.stringify({ userName: 'ada@example.com' }),
      }),
    )
    expect(response.status).toBe(409)
    expect(createAuthUser).not.toHaveBeenCalled()
  })

  it('rejects invalid create payloads with 400', async () => {
    mockDb()
    const response = await handleCreateUser(
      scimRequest('/api/scim/v2/Users', {
        method: 'POST',
        body: JSON.stringify({ userName: 'not-an-email' }),
      }),
    )
    expect(response.status).toBe(400)
  })

  it('returns a member by id', async () => {
    mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    vi.mocked(findOrganizationMemberRoles).mockResolvedValue(['member'])

    const response = await handleGetUser(
      scimRequest('/api/scim/v2/Users/user-1'),
      'user-1',
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string }
    expect(body.id).toBe('user-1')
  })

  it('returns 404 for non-members', async () => {
    mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      createdAt: new Date(),
    })
    vi.mocked(findOrganizationMemberRoles).mockResolvedValue([])

    const response = await handleGetUser(
      scimRequest('/api/scim/v2/Users/user-1'),
      'user-1',
    )
    expect(response.status).toBe(404)
  })
})

describe('scim service · patch & delete', () => {
  const user = {
    id: 'user-1',
    name: 'Ada',
    email: 'ada@example.com',
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }

  function patchRequest(operations: unknown[]): Request {
    return scimRequest('/api/scim/v2/Users/user-1', {
      method: 'PATCH',
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: operations,
      }),
    })
  }

  it('deactivates a member on active=false', async () => {
    const { remove } = mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue(user)
    vi.mocked(deleteOrganizationMember).mockResolvedValue(true)

    const response = await handlePatchUser(patchRequest([
      { op: 'replace', path: 'active', value: false },
    ]), 'user-1')

    expect(response.status).toBe(200)
    expect(deleteOrganizationMember).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG_ID,
      userId: 'user-1',
    })
    expect(remove).toHaveBeenCalled()
    expect(recordPermissionChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `scim:deprovision:${REALM_ID}:user-1`,
      }),
    )
    const body = (await response.json()) as { active: boolean }
    expect(body.active).toBe(false)
  })

  it('re-activates a member on active=true', async () => {
    const { insert } = mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue(user)
    vi.mocked(findOrganizationMemberRoles).mockResolvedValue([])

    const response = await handlePatchUser(patchRequest([
      { op: 'replace', path: 'active', value: true },
    ]), 'user-1')

    expect(response.status).toBe(200)
    expect(provisionOrganizationMember).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ORG_ID, userId: 'user-1', role: 'member' },
    )
    expect(insert).toHaveBeenCalled()
    const body = (await response.json()) as { active: boolean }
    expect(body.active).toBe(true)
  })

  it('skips addMember when the member already exists during activation', async () => {
    mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue(user)
    vi.mocked(findOrganizationMemberRoles).mockResolvedValue(['member'])

    const response = await handlePatchUser(patchRequest([
      { op: 'replace', path: 'active', value: true },
    ]), 'user-1')

    expect(response.status).toBe(200)
    expect(provisionOrganizationMember).not.toHaveBeenCalled()
  })

  it('rejects unsupported patch operations with 400', async () => {
    mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue(user)

    const response = await handlePatchUser(patchRequest([
      { op: 'add', path: 'emails', value: [] },
    ]), 'user-1')
    expect(response.status).toBe(400)
  })

  it('deprovisions on DELETE and returns 204', async () => {
    const { remove } = mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue(user)
    vi.mocked(deleteOrganizationMember).mockResolvedValue(true)

    const response = await handleDeleteUser(
      scimRequest('/api/scim/v2/Users/user-1', { method: 'DELETE' }),
      'user-1',
    )

    expect(response.status).toBe(204)
    expect(deleteOrganizationMember).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG_ID,
      userId: 'user-1',
    })
    expect(remove).toHaveBeenCalled()
  })

  it('returns 404 when DELETE targets an unknown user', async () => {
    mockDb()
    vi.mocked(findAuthUserById).mockResolvedValue(null)

    const response = await handleDeleteUser(
      scimRequest('/api/scim/v2/Users/user-x', { method: 'DELETE' }),
      'user-x',
    )
    expect(response.status).toBe(404)
  })
})
