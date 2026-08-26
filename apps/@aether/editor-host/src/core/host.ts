// @aether/editor-host · 宿主控制器。
// 组装 Y.Doc + Provider + Presence 为单一时钟对象，供 UI 与 Drift 持久化复用。
import type * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { createRealmDoc, docRefForRealm, getOrCreateText } from './doc'
import { createProvider, type CurrentProvider } from './provider'
import { PresenceChannel } from './presence'
import {
  DriftPersistence,
  IndexedDbDriftStore,
  type DriftStatus,
  type DriftStatusListener,
} from './drift'

export interface HostInit {
  /** realm slug，用于派生 doc_ref 与频道名 */
  realmSlug: string
  /** 当前客户端在场身份 */
  actorId: string
  /** 默认打开的文件路径 */
  filePath: string
  /** converge-server 地址：CF Worker 基址（wss://aether-converge.xxx.workers.dev）或旧版完整端点（wss://sync.cosky.top/api/ws） */
  convergeUrl?: string
  /** 启用 Drift 本地持久化；缺省关闭（M1 Drift Persistence） */
  drift?: {
    enabled?: boolean
    /** 压实阈值：追加 update 达到该数后写全量快照 */
    compactionThreshold?: number
    dbName?: string
  }
}

export class EditorHost {
  readonly doc: Y.Doc
  readonly provider: CurrentProvider
  readonly presence: PresenceChannel
  readonly drift: DriftPersistence | null
  readonly filePath: string
  private readonly driftStore: IndexedDbDriftStore | null

  constructor(init: HostInit) {
    const docRef = docRefForRealm(init.realmSlug)
    this.doc = createRealmDoc(docRef)
    this.filePath = init.filePath

    const awareness = new Awareness(this.doc)
    this.presence = new PresenceChannel(awareness)
    this.presence.setPresence({
      actorId: init.actorId,
      cursor: null,
      selection: null,
      lastSeenAt: Date.now(),
    })

    // 根据 convergeUrl 选择 Provider：
    // - 有 convergeUrl → Hocuspocus WebSocket Provider（生产环境）
    // - 无 convergeUrl → BroadcastChannel Provider（本地开发/离线模式）
    const providerOptions: Parameters<typeof createProvider>[2] = {
      docName: docRef,
    }
    if (init.convergeUrl) {
      providerOptions.convergeUrl = init.convergeUrl
    }
    providerOptions.parameters = { actorId: init.actorId }
    this.provider = createProvider(this.doc, awareness, providerOptions)

    if (init.drift?.enabled) {
      const driftInit = init.drift
      this.driftStore = new IndexedDbDriftStore(
        driftInit.dbName ? { dbName: driftInit.dbName } : {},
      )
      this.drift = new DriftPersistence(this.doc, {
        docRef,
        store: this.driftStore,
        ...(driftInit.compactionThreshold !== undefined
          ? { compactionThreshold: driftInit.compactionThreshold }
          : {}),
      })
    } else {
      this.driftStore = null
      this.drift = null
    }
  }

  get text(): Y.Text {
    return getOrCreateText(this.doc, this.filePath)
  }

  /** 从本地 Drift 存储恢复文档状态，返回恢复的 update 条数 */
  async restoreDrift(): Promise<number> {
    if (!this.drift) {
      return 0
    }
    return this.drift.restore()
  }

  get driftStatus(): DriftStatus | null {
    return this.drift?.status ?? null
  }

  subscribeDriftStatus(listener: DriftStatusListener): () => void {
    if (!this.drift) {
      listener('idle')
      return () => undefined
    }
    return this.drift.subscribeStatus(listener)
  }

  /** 连接 Provider 并广播自己的在场状态 */
  connect(): void {
    this.provider.connect()
    this.presence.updatePresence({ field: 'lastSeenAt', value: Date.now() })
  }

  disconnect(): void {
    this.provider.disconnect()
  }

  destroy(): void {
    this.drift?.destroy()
    void this.driftStore?.close()
    this.provider.destroy()
    this.presence.destroy()
  }
}
