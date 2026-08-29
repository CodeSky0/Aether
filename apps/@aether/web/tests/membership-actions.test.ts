import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptOrganizationInvitation,
  cancelOrganizationInvitation,
  inviteToOrganization,
  listOrganizationInvitations,
} from '@aether/auth'
import { getDb } from '@/lib/db'
import {
  requireEntitlement,
  resolveCurrentActor,
} from '@/lib/auth-guard'
import { tryGetAuth } from '@/lib/auth'
import { ensureRealmMembership } from '@/lib/membership-provisioning'
import { requireRealmRole } from '@/lib/membership-guard'
import {
  acceptRealmInvitation,
  inviteRealmMember,
  listRealmMembers,
  listRealmInvitations,
  revokeRealmInvitation,
} from '@/app/actions/membership'
import type { ActionResult } from '@/lib/action-result'

vi.mock('@aether/auth', () => ({
  acceptOrganizationInvitation: vi.fn(),
  cancelOrganizationInvitation: vi.fn(),
  inviteToOrganization: vi.fn(),
  listOrganizationInvitations: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({
  requireEntitlement: vi.fn(),
  resolveCurrentActor: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  tryGetAuth: vi.fn(),
}))

vi.mock('@/lib/membership-provisioning', () => ({
  ensureRealmMembership: vi.fn(),
}))

vi.mock('@/lib/membership-utils', () => ({
  isPlaceholderOrganization: (id: string) =>
    id.startsWith('org-placeholder-'),
  UNBOUND_REALM_ORGANIZATION_MESSAGE:
    'Realm is not bound to a Better-Auth organization; rebuild or bind the Realm first',
}))

vi.mock('@/lib/membership-guard', () => ({
  MANAGE_MEMBER_ROLES: ['owner', 'admin'],
  READ_MEMBER_ROLES: ['owner', 'admin', 'member'],
  requireRealmRole: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers({ cookie: 'session=token' }))),
}))

const mockedGetDb = vi.mocked(getDb)
const mockedRequireEntitlement = vi.mocked(requireEntitlement)
const mockedResolveCurrentActor = vi.mocked(resolveCurrentActor)
const mockedTryGetAuth = vi.mocked(tryGetAuth)
const mockedInvite = vi.mocked(inviteToOrganization)
const mockedListInvitations = vi.mocked(listOrganizationInvitations)
const mockedCancelInvitation = vi.mocked(cancelOrganizationInvitation)
const mockedRequireRealmRole = vi.mocked(requireRealmRole)

function mockRealm(authOrgId: string) {
  mockedGetDb.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000', authOrgId }]),
        })),
      })),
    })),
  } as never)
}

/** ActionResult 契约断言：动作不抛异常，而是收敛为 { success: false, error }。 */
async function expectActionFailure(
  promise: Promise<ActionResult<unknown>>,
  fragment: string,
) {
  const result = await promise
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error).toContain(fragment)
  return result
}

describe('membership actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedTryGetAuth.mockReturnValue({} as NonNullable<ReturnType<typeof tryGetAuth>>)
    mockedResolveCurrentActor.mockResolvedValue({
      actorType: 'human',
      actorId: 'user-1',
    })
    mockedRequireRealmRole.mockResolvedValue('admin')
  })

  it('rejects unsupported invitation roles', async () => {
    mockRealm('org-1')

    await expectActionFailure(
      inviteRealmMember({
        realmId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'member@example.com',
        role: 'owner,admin',
      }),
      'Invalid membership role',
    )
    expect(mockedInvite).not.toHaveBeenCalled()
  })

  it('reports placeholder organization binding errors', async () => {
    mockRealm('org-placeholder-1')

    await expectActionFailure(
      listRealmInvitations({ realmId: '550e8400-e29b-41d4-a716-446655440000' }),
      'not bound to a Better-Auth organization',
    )
    expect(mockedRequireEntitlement).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', {
      resource: 'realm',
      action: 'read',
    })
  })

  it('rejects invitations without a session before authorization or Realm lookup', async () => {
    mockedResolveCurrentActor.mockResolvedValue(null)

    await expectActionFailure(
      inviteRealmMember({
        realmId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'member@example.com',
        role: 'member',
      }),
      'without an authenticated session',
    )

    expect(mockedRequireEntitlement).not.toHaveBeenCalled()
    expect(mockedGetDb).not.toHaveBeenCalled()
    expect(mockedTryGetAuth).not.toHaveBeenCalled()
  })

  it('rejects invitation listing without a session before authorization or Realm lookup', async () => {
    mockedResolveCurrentActor.mockResolvedValue(null)

    await expectActionFailure(
      listRealmInvitations({ realmId: '550e8400-e29b-41d4-a716-446655440000' }),
      'without an authenticated session',
    )

    expect(mockedRequireEntitlement).not.toHaveBeenCalled()
    expect(mockedGetDb).not.toHaveBeenCalled()
    expect(mockedTryGetAuth).not.toHaveBeenCalled()
  })

  it('checks manage_member before inviting', async () => {
    mockRealm('org-1')

    const result = await inviteRealmMember({
      realmId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'member@example.com',
      role: 'member',
    })

    expect(result.success).toBe(true)
    expect(mockedRequireEntitlement).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', {
      resource: 'realm',
      action: 'manage_member',
    })
    expect(mockedRequireRealmRole).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      { actorType: 'human', actorId: 'user-1' },
      ['owner', 'admin'],
    )
  })

  it('rejects management when the Realm role guard denies the actor', async () => {
    mockedRequireRealmRole.mockRejectedValue(
      new Error('Realm membership does not permit this operation'),
    )

    await expectActionFailure(
      inviteRealmMember({
        realmId: '550e8400-e29b-41d4-a716-446655440000',
        email: 'member@example.com',
        role: 'member',
      }),
      'does not permit this operation',
    )
    expect(mockedInvite).not.toHaveBeenCalled()
  })

  it('accepts with the session and mirrors the resulting organization', async () => {
    vi.mocked(acceptOrganizationInvitation).mockResolvedValue({
      invitation: { organizationId: 'org-1' },
    } as never)
    mockedGetDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000' }]),
          })),
        })),
      })),
    } as never)

    const result = await acceptRealmInvitation({ invitationId: '660e8400-e29b-41d4-a716-446655440000' })

    expect(result.success).toBe(true)
    expect(acceptOrganizationInvitation).toHaveBeenCalled()
    expect(vi.mocked(ensureRealmMembership)).toHaveBeenCalledWith({
      realmId: '550e8400-e29b-41d4-a716-446655440000',
      actorType: 'human',
      actorId: 'user-1',
    })
  })

  it('lists Realm members through the realm guard and returns current role', async () => {
    mockedGetDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            {
              id: 'member-1',
              actor_type: 'human',
              actor_id: 'user-1',
              role: 'admin',
              status: 'active',
              project_id: null,
              created_at: new Date('2026-01-01T00:00:00Z'),
            },
          ]),
        })),
      })),
    } as never)

    mockedRequireRealmRole.mockResolvedValue('owner')

    await expect(listRealmMembers({ realmId: '550e8400-e29b-41d4-a716-446655440000' })).resolves.toMatchObject({
      success: true,
      data: {
        currentActorRole: 'owner',
        members: [{ id: 'member-1', actor_id: 'user-1' }],
      },
    })
    expect(mockedRequireEntitlement).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', {
      resource: 'realm',
      action: 'read',
    })
  })

  it('rejects revocation when the invitation belongs to another organization', async () => {
    mockRealm('org-1')
    mockedListInvitations.mockResolvedValue([
      { id: '660e8400-e29b-41d4-a716-446655440000', organizationId: 'org-2' },
    ] as never)

    await expectActionFailure(
      revokeRealmInvitation({
        realmId: '550e8400-e29b-41d4-a716-446655440000',
        invitationId: '660e8400-e29b-41d4-a716-446655440000',
      }),
      'does not belong to this Realm organization',
    )
    expect(mockedCancelInvitation).not.toHaveBeenCalled()
  })

  it('revokes a Realm invitation only after confirming its organization', async () => {
    mockRealm('org-1')
    mockedListInvitations.mockResolvedValue([
      { id: '660e8400-e29b-41d4-a716-446655440000', organizationId: 'org-1' },
    ] as never)
    mockedCancelInvitation.mockResolvedValue({ invitation: { id: '660e8400-e29b-41d4-a716-446655440000' } } as never)

    const result = await revokeRealmInvitation({
      realmId: '550e8400-e29b-41d4-a716-446655440000',
      invitationId: '660e8400-e29b-41d4-a716-446655440000',
    })

    expect(result.success).toBe(true)
    expect(mockedListInvitations).toHaveBeenCalledWith(
      {},
      expect.any(Headers),
      { organizationId: 'org-1' },
    )
    expect(mockedCancelInvitation).toHaveBeenCalledWith(
      {},
      expect.any(Headers),
      { invitationId: '660e8400-e29b-41d4-a716-446655440000' },
    )
  })

  it('rejects member listing and revocation without a session before database or auth access', async () => {
    mockedResolveCurrentActor.mockResolvedValue(null)

    await expectActionFailure(
      listRealmMembers({ realmId: '550e8400-e29b-41d4-a716-446655440000' }),
      'without an authenticated session',
    )
    await expectActionFailure(
      revokeRealmInvitation({ realmId: '550e8400-e29b-41d4-a716-446655440000', invitationId: '660e8400-e29b-41d4-a716-446655440000' }),
      'without an authenticated session',
    )
    expect(mockedGetDb).not.toHaveBeenCalled()
    expect(mockedTryGetAuth).not.toHaveBeenCalled()
  })
})
