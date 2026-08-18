// @aether/entitlement · Entitlement Engine 纯判定层
import { realmRoles } from '@aether/auth'
import type { ActorType } from '@aether/types'

export type EntitlementResource =
  | 'realm'
  | 'project'
  | 'thread'
  | 'entity'
  | 'current'
  | 'audit'

export interface EntitlementSubject {
  realmId: string
  actorType: ActorType
  actorId: string
  memberships: readonly EntitlementMembership[]
}

export interface EntitlementMembership {
  role: string
  projectId: string | null
  status: 'active' | 'invited' | 'suspended'
  entitlements: Record<string, unknown>
}

export interface EntitlementRequest {
  resource: EntitlementResource
  action: string
  projectId?: string
  resourceId?: string
}

export type EntitlementDenyReason =
  | 'no_membership'
  | 'scope_mismatch'
  | 'role_denied'
  | 'resource_denied'
  | 'entity_not_granted'

export type EntitlementDecision =
  | {
      allowed: true
      layer: 'role' | 'resource'
      reason: 'granted'
      matchedProjectId?: string | null
    }
  | {
      allowed: false
      layer: 'role' | 'scope' | 'resource'
      reason: EntitlementDenyReason
    }

export class EntitlementDeniedError extends Error {
  readonly reason: EntitlementDenyReason
  readonly request: EntitlementRequest

  constructor(reason: EntitlementDenyReason, request: EntitlementRequest) {
    super(`Entitlement denied: ${reason}`)
    this.name = 'EntitlementDeniedError'
    this.reason = reason
    this.request = request
  }
}

const WRITE_ACTIONS = new Set([
  'create',
  'update',
  'delete',
  'converge',
  'drift',
  'resolve',
  'archive',
  'manage_member',
])

const DENY_PRIORITY: readonly EntitlementDenyReason[] = [
  'resource_denied',
  'entity_not_granted',
  'role_denied',
  'scope_mismatch',
]

function roleAllows(role: string, request: EntitlementRequest): boolean {
  const roleDefinition: unknown =
    realmRoles[role as keyof typeof realmRoles]
  if (
    typeof roleDefinition !== 'object' ||
    roleDefinition === null ||
    !('statements' in roleDefinition)
  ) {
    return false
  }
  const statements: unknown = roleDefinition.statements
  if (
    typeof statements !== 'object' ||
    statements === null ||
    Array.isArray(statements) ||
    !(request.resource in statements)
  ) {
    return false
  }
  const statementMap = statements as Record<string, unknown>
  const permissions: unknown = statementMap[request.resource]
  return (
    Array.isArray(permissions) &&
    permissions.every((permission): permission is string => typeof permission === 'string') &&
    permissions.includes(request.action)
  )
}

function scopeMatches(
  membership: EntitlementMembership,
  request: EntitlementRequest,
): boolean {
  if (request.projectId === undefined) {
    return membership.projectId === null
  }
  return membership.projectId === null || membership.projectId === request.projectId
}

function entitlementValue(
  membership: EntitlementMembership,
  request: EntitlementRequest,
): boolean | undefined {
  const typeKey = `${request.resource}:${request.action}`
  const resourceKey =
    request.resourceId === undefined
      ? undefined
      : `${typeKey}:${request.resourceId}`
  if (resourceKey !== undefined) {
    const resourceValue = membership.entitlements[resourceKey]
    if (typeof resourceValue === 'boolean') return resourceValue
  }
  const typeValue = membership.entitlements[typeKey]
  return typeof typeValue === 'boolean' ? typeValue : undefined
}

function deniedDecision(
  reason: EntitlementDenyReason,
): EntitlementDecision {
  const layer: EntitlementDecision['layer'] =
    reason === 'no_membership' || reason === 'scope_mismatch'
      ? 'scope'
      : reason === 'role_denied'
        ? 'role'
        : 'resource'
  return { allowed: false, layer, reason }
}

function mostSpecificDeny(
  reasons: readonly EntitlementDenyReason[],
): EntitlementDecision {
  for (const reason of DENY_PRIORITY) {
    if (reasons.includes(reason)) return deniedDecision(reason)
  }
  return deniedDecision('scope_mismatch')
}

export function evaluateEntitlement(
  subject: EntitlementSubject,
  request: EntitlementRequest,
): EntitlementDecision {
  const activeMemberships = subject.memberships.filter(
    (membership) => membership.status === 'active',
  )
  if (activeMemberships.length === 0) {
    return deniedDecision('no_membership')
  }

  const reasons: EntitlementDenyReason[] = []
  for (const membership of activeMemberships) {
    if (!scopeMatches(membership, request)) {
      reasons.push('scope_mismatch')
      continue
    }
    if (!roleAllows(membership.role, request)) {
      reasons.push('role_denied')
      continue
    }

    const explicitEntitlement = entitlementValue(membership, request)
    if (explicitEntitlement === false) {
      reasons.push('resource_denied')
      continue
    }
    if (
      subject.actorType === 'entity' &&
      WRITE_ACTIONS.has(request.action) &&
      explicitEntitlement !== true
    ) {
      reasons.push('entity_not_granted')
      continue
    }

    return {
      allowed: true,
      layer: explicitEntitlement === undefined ? 'role' : 'resource',
      reason: 'granted',
      matchedProjectId: membership.projectId,
    }
  }
  return mostSpecificDeny(reasons)
}

export function assertEntitlement(
  subject: EntitlementSubject,
  request: EntitlementRequest,
): void {
  const decision = evaluateEntitlement(subject, request)
  if (decision.allowed) return
  throw new EntitlementDeniedError(decision.reason, request)
}
