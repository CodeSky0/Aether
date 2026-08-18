// @aether/entitlement · 三级授权判定引擎入口
export {
  assertEntitlement,
  EntitlementDeniedError,
  evaluateEntitlement,
  type EntitlementDecision,
  type EntitlementDenyReason,
  type EntitlementMembership,
  type EntitlementRequest,
  type EntitlementResource,
  type EntitlementSubject,
} from './evaluate.js'
export {
  loadEntitlementSubject,
} from './loader.js'
