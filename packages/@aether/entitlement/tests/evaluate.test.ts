// @aether/entitlement · 三级授权判定验收测试
import { describe, expect, it } from 'vitest'
import {
  assertEntitlement,
  EntitlementDeniedError,
  evaluateEntitlement,
  type EntitlementMembership,
  type EntitlementSubject,
} from '../src/evaluate.js'

const realmId = 'realm-1'
const actorId = 'actor-1'

function membership(
  overrides: Partial<EntitlementMembership> = {},
): EntitlementMembership {
  return {
    role: 'member',
    projectId: null,
    status: 'active',
    entitlements: {},
    ...overrides,
  }
}

function subject(
  memberships: readonly EntitlementMembership[],
  actorType: 'human' | 'entity' = 'human',
): EntitlementSubject {
  return { realmId, actorType, actorId, memberships }
}

describe('evaluateEntitlement', () => {
  it('允许角色声明的动作', () => {
    expect(
      evaluateEntitlement(subject([membership({ role: 'admin' })]), {
        resource: 'thread',
        action: 'create',
      }),
    ).toMatchObject({ allowed: true, layer: 'role', reason: 'granted' })
  })

  it('拒绝角色未声明的动作', () => {
    expect(
      evaluateEntitlement(subject([membership()]), {
        resource: 'audit',
        action: 'read',
      }),
    ).toMatchObject({ allowed: false, layer: 'role', reason: 'role_denied' })
  })

  it('Realm 级成员覆盖 Realm 级与项目级请求', () => {
    const realmMember = membership({ role: 'admin' })
    expect(
      evaluateEntitlement(subject([realmMember]), {
        resource: 'audit',
        action: 'read',
      }).allowed,
    ).toBe(true)
    expect(
      evaluateEntitlement(subject([realmMember]), {
        resource: 'thread',
        action: 'create',
        projectId: 'project-1',
      }).allowed,
    ).toBe(true)
  })

  it('项目级成员仅覆盖同项目请求', () => {
    const projectMember = membership({
      role: 'member',
      projectId: 'project-1',
    })
    expect(
      evaluateEntitlement(subject([projectMember]), {
        resource: 'thread',
        action: 'read',
        projectId: 'project-1',
      }).allowed,
    ).toBe(true)
    expect(
      evaluateEntitlement(subject([projectMember]), {
        resource: 'thread',
        action: 'read',
        projectId: 'project-2',
      }),
    ).toMatchObject({ allowed: false, reason: 'scope_mismatch' })
    expect(
      evaluateEntitlement(subject([projectMember]), {
        resource: 'thread',
        action: 'read',
      }),
    ).toMatchObject({ allowed: false, reason: 'scope_mismatch' })
  })

  it('资源类型级 entitlement 覆盖角色判定', () => {
    expect(
      evaluateEntitlement(
        subject([
          membership({
            role: 'admin',
            entitlements: { 'thread:create': false },
          }),
        ]),
        { resource: 'thread', action: 'create' },
      ),
    ).toMatchObject({
      allowed: false,
      layer: 'resource',
      reason: 'resource_denied',
    })
  })

  it('单资源级 entitlement 优先于资源类型级 entitlement', () => {
    expect(
      evaluateEntitlement(
        subject([
          membership({
            role: 'member',
            entitlements: {
              'current:converge': false,
              'current:converge:realm-1/doc-1': true,
            },
          }),
        ]),
        {
          resource: 'current',
          action: 'converge',
          resourceId: 'realm-1/doc-1',
        },
      ),
    ).toMatchObject({ allowed: true, layer: 'resource' })
  })

  it('单资源级显式否决优先于角色允许', () => {
    expect(
      evaluateEntitlement(
        subject([
          membership({
            role: 'admin',
            entitlements: { 'thread:create:thread-1': false },
          }),
        ]),
        { resource: 'thread', action: 'create', resourceId: 'thread-1' },
      ),
    ).toMatchObject({ allowed: false, reason: 'resource_denied' })
  })

  it('Entity 写动作必须有显式 true', () => {
    const request = { resource: 'current' as const, action: 'converge' }
    expect(
      evaluateEntitlement(subject([membership({ role: 'admin' })], 'entity'), request),
    ).toMatchObject({ allowed: false, reason: 'entity_not_granted' })
    expect(
      evaluateEntitlement(
        subject(
          [membership({ role: 'admin', entitlements: { 'current:converge': true } })],
          'entity',
        ),
        request,
      ).allowed,
    ).toBe(true)
  })

  it('Entity 读动作仍遵循常规三级判定', () => {
    expect(
      evaluateEntitlement(
        subject([membership({ role: 'member' })], 'entity'),
        { resource: 'thread', action: 'read' },
      ).allowed,
    ).toBe(true)
  })

  it('非 active 成员拒绝', () => {
    expect(
      evaluateEntitlement(
        subject([membership({ role: 'admin', status: 'invited' })]),
        { resource: 'thread', action: 'create' },
      ),
    ).toMatchObject({ allowed: false, reason: 'no_membership' })
  })

  it('多 membership 任一通过即允许', () => {
    expect(
      evaluateEntitlement(
        subject([
          membership({ role: 'member', projectId: 'project-1' }),
          membership({ role: 'admin', projectId: 'project-2' }),
        ]),
        { resource: 'thread', action: 'create', projectId: 'project-2' },
      ),
    ).toMatchObject({ allowed: true, matchedProjectId: 'project-2' })
  })

  it('全拒时返回最具体的拒绝原因', () => {
    expect(
      evaluateEntitlement(
        subject([
          membership({ role: 'member', entitlements: { 'thread:create': false } }),
          membership({ role: 'member' }),
        ], 'entity'),
        { resource: 'thread', action: 'create' },
      ),
    ).toMatchObject({ allowed: false, reason: 'resource_denied' })
  })

  it('assertEntitlement 拒绝时抛出带请求与原因的错误', () => {
    const request = { resource: 'audit' as const, action: 'read' }
    expect(() => assertEntitlement(subject([membership()]), request)).toThrow(
      EntitlementDeniedError,
    )
    try {
      assertEntitlement(subject([membership()]), request)
    } catch (error) {
      expect(error).toBeInstanceOf(EntitlementDeniedError)
      expect((error as EntitlementDeniedError).reason).toBe('role_denied')
      expect((error as EntitlementDeniedError).request).toEqual(request)
    }
  })
})
