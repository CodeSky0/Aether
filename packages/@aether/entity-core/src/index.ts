// @aether/entity-core · Entity 运行时核心入口
// 对外暴露 Capability Manifesto、Handoff Gate、Audit Trail、Identity、Presence Cursor。
// 下游经本包使用 Entity 运行时能力，不直接依赖 @aether/auth/@aether/db 的内部实现。
export {
  MANIFESTO_SCHEMA_VERSION,
  REALM_STATEMENTS,
  REALM_STATEMENT_SET,
  canInvokeTool,
  declareCapabilityManifesto,
  hasPermission,
  isPermissionGranted,
  toStoredManifesto,
  validateCapabilityManifesto,
  type CapabilityManifesto,
  type DeclareManifestoInput,
  type ManifestoValidationResult,
  type RealmStatement,
  type StoredCapabilityManifesto,
} from './manifesto.js'
export {
  HandoffGate,
  HandoffGateError,
  type HandoffDecision,
  type HandoffEvent,
  type HandoffGateOptions,
  type HandoffGateState,
  type HandoffListener,
  type HandoffRequest,
} from './handoff.js'
export {
  computePayloadHash,
  hasEntityActionBeenRecorded,
  queryAuditLog,
  queryEntityAuditLog,
  recordAudit,
  recordEntityAction,
  type AuditDb,
  type AuditLogRecord,
  type AuditQueryFilter,
  type AuditRecordInput,
} from './audit.js'
export {
  getEntitiesByAuthIdentity,
  getEntity,
  listEntities,
  parseEntityManifesto,
  registerEntity,
  suspendEntity,
  updateEntity,
  type EntityDb,
  type EntityRecord,
  type RegisterEntityInput,
  type UpdateEntityInput,
} from './identity.js'
export {
  EntityPresenceCursor,
  type EntityCursor,
  type EntityPresenceOptions,
  type EntityPresenceWrapOptions,
} from './presence.js'
export {
  EntityRuntime,
  EntityHandoffRequiredError,
  createEntityRuntime,
  type EntityChatMessage,
  type EntityChatResult,
  type EntityLanguageModel,
  type EntityStreamOptions,
  type EntityStreamResult,
  type EntityTextResult,
  type EntityToolDefinition,
  type EntityRuntimeOptions,
} from './runtime.js'
export {
  createEntityLanguageModel,
  loadProviderModel,
  resolveProviderConfig,
  type EntityProvider,
  type ProviderConfig,
} from './provider.js'
