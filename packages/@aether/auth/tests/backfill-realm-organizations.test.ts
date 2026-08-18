import { describe, expect, it, vi } from 'vitest'
import {
  parseBackfillArgs,
  resolveOwnerEmail,
  runBackfill,
  type BackfillDependencies,
  type BackfillRealm,
} from '../scripts/backfill-realm-organizations.js'

const realms: BackfillRealm[] = [
  {
    id: 'realm-1',
    slug: 'alpha',
    name: 'Alpha',
    authOrgId: 'org-placeholder-1',
  },
  {
    id: 'realm-2',
    slug: 'beta',
    name: 'Beta',
    authOrgId: 'org-real',
  },
]

describe('backfill realm organization logic', () => {
  it('parses repeated realm overrides and gives them priority', () => {
    const args = parseBackfillArgs([
      '--owner-email',
      'default@example.com',
      '--realm',
      'alpha=override@example.com',
      '--realm',
      'beta=beta@example.com',
    ])

    expect(resolveOwnerEmail('alpha', args)).toBe('override@example.com')
    expect(resolveOwnerEmail('other', args)).toBe('default@example.com')
    expect(args.apply).toBe(false)
  })

  it('skips already bound and ownerless realms', async () => {
    const findUserIdByEmail = vi.fn().mockResolvedValue('user-1')
    const dependencies: BackfillDependencies = {
      findUserIdByEmail,
      findReusableOrganizationId: vi.fn().mockResolvedValue(null),
      createOrganization: vi.fn(),
      applyRealm: vi.fn(),
    }

    const summary = await runBackfill(realms, dependencies, {
      apply: false,
      realmOwners: new Map(),
    })

    expect(summary.processed).toBe(0)
    expect(summary.skipped).toBe(2)
    expect(findUserIdByEmail).not.toHaveBeenCalled()
  })

  it('does not write during dry-run', async () => {
    const findUserIdByEmail = vi.fn().mockResolvedValue('user-1')
    const createOrganization = vi.fn()
    const applyRealm = vi.fn()
    const dependencies: BackfillDependencies = {
      findUserIdByEmail,
      findReusableOrganizationId: vi.fn().mockResolvedValue(null),
      createOrganization,
      applyRealm,
    }

    const summary = await runBackfill([realms[0]!], dependencies, {
      apply: false,
      ownerEmail: 'owner@example.com',
      realmOwners: new Map(),
    })

    expect(summary.processed).toBe(1)
    expect(findUserIdByEmail).toHaveBeenCalledWith('owner@example.com')
    expect(createOrganization).not.toHaveBeenCalled()
    expect(applyRealm).not.toHaveBeenCalled()
  })

  it('uses the owner override and records missing users as failures', async () => {
    const createOrganization = vi.fn().mockResolvedValue({ id: 'org-2' })
    const dependencies: BackfillDependencies = {
      findUserIdByEmail: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('user-2'),
      findReusableOrganizationId: vi.fn().mockResolvedValue(null),
      createOrganization,
      applyRealm: vi.fn(),
    }

    const summary = await runBackfill(
      [realms[0]!, { ...realms[0]!, slug: 'gamma' }],
      dependencies,
      {
        apply: true,
        ownerEmail: 'default@example.com',
        realmOwners: new Map([['alpha', 'missing@example.com']]),
      },
    )

    expect(summary.failed).toBe(1)
    expect(summary.processed).toBe(1)
    expect(createOrganization).toHaveBeenCalledWith({
      name: 'Alpha',
      slug: 'gamma',
      ownerUserId: 'user-2',
    })
  })

  it('counts realm overrides that match no Realm as failures', async () => {
    const dependencies: BackfillDependencies = {
      findUserIdByEmail: vi.fn(),
      findReusableOrganizationId: vi.fn().mockResolvedValue(null),
      createOrganization: vi.fn(),
      applyRealm: vi.fn(),
    }

    const summary = await runBackfill(realms, dependencies, {
      apply: false,
      realmOwners: new Map([['typo-alpha', 'owner@example.com']]),
    })

    expect(summary.failed).toBe(1)
    expect(summary.failureReasons).toContain(
      'typo-alpha: --realm override did not match any Realm',
    )
  })

  it('reuses an orphan organization left by a previously failed apply', async () => {
    const createOrganization = vi.fn()
    const applyRealm = vi.fn()
    const dependencies: BackfillDependencies = {
      findUserIdByEmail: vi.fn().mockResolvedValue('user-1'),
      findReusableOrganizationId: vi.fn().mockResolvedValue('org-orphan'),
      createOrganization,
      applyRealm,
    }

    const summary = await runBackfill([realms[0]!], dependencies, {
      apply: true,
      ownerEmail: 'owner@example.com',
      realmOwners: new Map(),
    })

    expect(summary.processed).toBe(1)
    expect(createOrganization).not.toHaveBeenCalled()
    expect(applyRealm).toHaveBeenCalledWith({
      realm: realms[0],
      organizationId: 'org-orphan',
      ownerUserId: 'user-1',
    })
  })

  it('records reuse lookup rejections as failures without creating organizations', async () => {
    const createOrganization = vi.fn()
    const applyRealm = vi.fn()
    const dependencies: BackfillDependencies = {
      findUserIdByEmail: vi.fn().mockResolvedValue('user-1'),
      findReusableOrganizationId: vi
        .fn()
        .mockRejectedValue(
          new Error('organization slug alpha is already bound to Realm beta'),
        ),
      createOrganization,
      applyRealm,
    }

    const summary = await runBackfill([realms[0]!], dependencies, {
      apply: true,
      ownerEmail: 'owner@example.com',
      realmOwners: new Map(),
    })

    expect(summary.failed).toBe(1)
    expect(summary.failureReasons[0]).toContain('already bound to Realm beta')
    expect(createOrganization).not.toHaveBeenCalled()
    expect(applyRealm).not.toHaveBeenCalled()
  })
})
