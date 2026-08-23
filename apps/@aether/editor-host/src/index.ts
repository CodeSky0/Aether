// @aether/editor-host · Current 能力的渲染层兼容出口。
export * from '@aether/current-sync'
export {
  DriftPersistence,
  IndexedDbDriftStore,
  type DriftDocRecord,
  type DriftLoadResult,
  type DriftStatus,
  type DriftStatusListener,
  type DriftStore,
} from './core/drift'
export { EditorHost, type HostInit } from './core/host'
export {
  BroadcastChannelProvider,
  HocuspocusProviderAdapter,
  createProvider,
  type CurrentProvider,
} from './core/provider'
export {
  createRealmDoc,
  docRefForRealm,
  fileKey,
  getOrCreateText,
} from './core/doc'
