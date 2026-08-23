// @aether/editor-host · Yjs Provider 抽象与实现。
// - BroadcastChannelProvider：M0 基线，同源多标签页同步（无需后端）
// - HocuspocusProviderAdapter：M1 生产，通过 WebSocket 连接 converge-server
import * as Y from 'yjs'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  type Awareness,
} from 'y-protocols/awareness'
import { HocuspocusProvider } from '@hocuspocus/provider'

export interface ProviderOptions {
  /** BroadcastChannel 名，默认按 doc_ref 派生 */
  channelName?: string
}

/** Provider 生命周期接口 */
export interface CurrentProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  /** 连接当前状态：connected / disconnected */
  readonly status: 'connected' | 'disconnected'
  connect(): void
  disconnect(): void
  destroy(): void
  /** 订阅连接状态变化（可选） */
  subscribeConnectionState?(listener: (state: 'connected' | 'disconnected') => void): () => void
}

/**
 * BroadcastChannel Provider：同一浏览器多标签页共享一份 Y.Doc 与 Awareness。
 * 数据经结构化克隆在频道内传输，用于 M0 基线验证协同原语；
 * 生产收敛通道（Hocuspocus）在 M1 替换，本类不用于跨端。
 */
export class BroadcastChannelProvider implements CurrentProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  private channel: BroadcastChannel
  private _status: 'connected' | 'disconnected' = 'disconnected'
  private readonly onSync = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return
    this.channel.postMessage({ kind: 'sync', update })
  }
  private readonly onAwareness = (changes: {
    added: number[]
    updated: number[]
    removed: number[]
  }, origin: unknown) => {
    if (origin === this) return
    if (changes.added.length === 0 && changes.updated.length === 0 && changes.removed.length === 0) {
      return
    }
    const encoder = encodeAwarenessUpdate(
      this.awareness,
      [...changes.added, ...changes.updated, ...changes.removed],
    )
    this.channel.postMessage({ kind: 'awareness', update: encoder })
  }
  private readonly onMessage = (event: MessageEvent) => {
    const msg = event.data as { kind: string; update?: Uint8Array }
    if (!msg?.update) return
    if (msg.kind === 'sync') {
      Y.applyUpdate(this.doc, msg.update, this)
    } else if (msg.kind === 'awareness') {
      applyAwarenessUpdate(this.awareness, msg.update, this)
    }
  }

  constructor(doc: Y.Doc, awareness: Awareness, options: ProviderOptions = {}) {
    this.doc = doc
    this.awareness = awareness
    const channelName =
      options.channelName ?? `aether:${doc.guid ?? 'doc'}`
    this.channel = new BroadcastChannel(channelName)
  }

  get status(): 'connected' | 'disconnected' {
    return this._status
  }

  connect(): void {
    if (this._status === 'connected') return
    this.channel.addEventListener('message', this.onMessage)
    this.doc.on('update', this.onSync)
    this.awareness.on('update', this.onAwareness)
    this._status = 'connected'
  }

  disconnect(): void {
    if (this._status === 'disconnected') return
    this.channel.removeEventListener('message', this.onMessage)
    this.doc.off('update', this.onSync)
    this.awareness.off('update', this.onAwareness)
    this._status = 'disconnected'
  }

  destroy(): void {
    this.disconnect()
    this.channel.close()
  }
}

/**
 * Hocuspocus WebSocket Provider 适配器。
 * 将 @hocuspocus/provider 适配到 CurrentProvider 接口，
 * 通过 WebSocket 连接 converge-server 实现跨端实时同步。
 */
export class HocuspocusProviderAdapter implements CurrentProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  private hocuspocus: HocuspocusProvider
  private _status: 'connected' | 'disconnected' = 'disconnected'
  private statusListeners = new Set<(state: 'connected' | 'disconnected') => void>()

  constructor(
    doc: Y.Doc,
    awareness: Awareness,
    options: {
      /** converge-server WebSocket 地址，如 wss://sync.cosky.top/api/ws */
      url: string
      /** 文档名（用于 converge-server 路由到正确的 Yjs 文档） */
      name: string
      /** 连接参数（actorId 等） */
      parameters?: Record<string, unknown>
    },
  ) {
    this.doc = doc
    this.awareness = awareness

    const config: ConstructorParameters<typeof HocuspocusProvider>[0] = {
      url: options.url,
      name: options.name,
      document: doc,
      awareness,
      onConnect: () => {
        this._status = 'connected'
        this.statusListeners.forEach(l => l('connected'))
      },
      onDisconnect: () => {
        this._status = 'disconnected'
        this.statusListeners.forEach(l => l('disconnected'))
      },
      onStatus: ({ status }: { status: string }) => {
        this._status = status === 'connected' ? 'connected' : 'disconnected'
        this.statusListeners.forEach(l => l(this._status))
      },
    }
    if (options.parameters) {
      config.parameters = options.parameters
    }
    this.hocuspocus = new HocuspocusProvider(config)
  }

  get status(): 'connected' | 'disconnected' {
    return this._status
  }

  connect(): void {
    // HocuspocusProvider 自动连接，无需手动操作
  }

  disconnect(): void {
    this.hocuspocus.disconnect()
    this._status = 'disconnected'
    this.statusListeners.forEach(l => l('disconnected'))
  }

  destroy(): void {
    this.hocuspocus.destroy()
    this._status = 'disconnected'
    this.statusListeners.clear()
  }

  subscribeConnectionState(listener: (state: 'connected' | 'disconnected') => void): () => void {
    this.statusListeners.add(listener)
    listener(this._status)
    return () => {
      this.statusListeners.delete(listener)
    }
  }
}

/**
 * 创建 Provider 实例。
 * 如果提供了 convergeUrl，使用 Hocuspocus WebSocket Provider；
 * 否则回退到 BroadcastChannel Provider（本地开发/离线模式）。
 */
export function createProvider(
  doc: Y.Doc,
  awareness: Awareness,
  options: {
    convergeUrl?: string
    docName?: string
    parameters?: Record<string, unknown>
    channelName?: string
  } = {},
): CurrentProvider {
  if (options.convergeUrl) {
    const adapterOptions: ConstructorParameters<typeof HocuspocusProviderAdapter>[2] = {
      url: options.convergeUrl,
      name: options.docName ?? doc.guid ?? 'aether-doc',
    }
    if (options.parameters) {
      adapterOptions.parameters = options.parameters
    }
    return new HocuspocusProviderAdapter(doc, awareness, adapterOptions)
  }
  const bcOptions: ProviderOptions = {}
  if (options.channelName) {
    bcOptions.channelName = options.channelName
  }
  return new BroadcastChannelProvider(doc, awareness, bcOptions)
}
