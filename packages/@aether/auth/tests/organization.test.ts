import { describe, expect, it, vi } from 'vitest'
import type { AuthInstance } from '../src/instance.js'
import {
  acceptOrganizationInvitation,
  cancelOrganizationInvitation,
  createRealmOrganization,
  findOrganizationMemberRoles,
  inviteToOrganization,
  listOrganizationInvitations,
} from '../src/organization.js'
import { member } from '../src/schema.js'

describe('organization wrappers', () => {
  it('uses the system action shape to create an organization', async () => {
    const createOrganization = vi.fn().mockResolvedValue({ id: 'org-1' })
    const auth = {
      api: { createOrganization },
    } as unknown as AuthInstance

    await createRealmOrganization(auth, {
      name: 'Aether',
      slug: 'aether',
      ownerUserId: 'user-1',
    })

    expect(createOrganization).toHaveBeenCalledWith({
      body: { name: 'Aether', slug: 'aether', userId: 'user-1' },
    })
  })

  it('splits organization member roles and maps invitation endpoint arguments', async () => {
    const headers = new Headers({ cookie: 'session=token' })
    const rows = [{ role: 'admin, member' }]
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(rows),
        })),
      })),
    }
    const createInvitation = vi.fn().mockResolvedValue({ id: 'invite-1' })
    const listInvitations = vi.fn().mockResolvedValue([{ id: 'invite-1' }])
    const acceptInvitation = vi.fn().mockResolvedValue({
      invitation: { organizationId: 'org-1' },
    })
    const cancelInvitation = vi.fn().mockResolvedValue({
      invitation: { id: 'invite-1' },
    })
    const auth = {
      api: {
        createInvitation,
        listInvitations,
        acceptInvitation,
        cancelInvitation,
      },
    } as unknown as AuthInstance

    await expect(
      findOrganizationMemberRoles(db as never, {
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual(['admin', 'member'])
    await inviteToOrganization(auth, headers, {
      organizationId: 'org-1',
      email: 'member@example.com',
      role: 'member',
    })
    await listOrganizationInvitations(auth, headers, {
      organizationId: 'org-1',
    })
    await acceptOrganizationInvitation(auth, headers, {
      invitationId: 'invite-1',
    })
    await cancelOrganizationInvitation(auth, headers, {
      invitationId: 'invite-1',
    })

    expect(createInvitation).toHaveBeenCalledWith({
      headers,
      body: {
        organizationId: 'org-1',
        email: 'member@example.com',
        role: 'member',
      },
    })
    expect(listInvitations).toHaveBeenCalledWith({
      headers,
      query: { organizationId: 'org-1' },
    })
    expect(acceptInvitation).toHaveBeenCalledWith({
      headers,
      body: { invitationId: 'invite-1' },
    })
    expect(cancelInvitation).toHaveBeenCalledWith({
      headers,
      body: { invitationId: 'invite-1' },
    })
    expect(member).toBeDefined()
  })
})
