// @aether/converge-server · Cloudflare Durable Object 版 Yjs 房间。
// 每个文档（docName）对应一个 YjsRoom DO 实例：
//   - 内存中持有权威 Y.Doc 与 Awareness 状态
//   - 通过 y-protocols 标准同步协议与 HocuspocusProvider 通信
//   - 更新经 alarm 防抖后全量快照写入 DO Storage（免费且持久）
//
// 线协议（与 @hocuspocus/provider 2.15.x 对齐，逐条消息格式）：
//   varString(docName) + varUint(messageType) + payload
//   messageType: Sync=0, Awareness=1, Auth=2, QueryAwareness=3,
//                SyncReply=4(勿发，2.15.3 客户端不识别), Stateless=5, CLOSE=7, SyncStatus=8
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'

/** 与 @hocuspocus/common MessageType 对齐 */
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3
const MESSAGE_CLOSE = 7
const MESSAGE_SYNC_STATUS = 8

/** 持久化防抖：文档更新后至少间隔该时长再落盘 */
const PERSIST_DEBOUNCE_MS = 3_000
/** 单值分片大小：128KB 对 KV/SQLite 后端均安全 */
const PERSIST_CHUNK_SIZE = 128 * 1024
const META_KEY = 'docMeta'
const CHUNK_PREFIX = 'docChunk:'

/** 加载持久化状态时的事务 origin（跳过广播与落盘调度） */
const LOAD_ORIGIN = Symbol('aether-load')

interface DocMeta {
  chunkCount: number
}

/** 每个连接的附属状态：该连接控制的 awareness clientID 集合 */
interface ConnState {
  controlledIds: Set<number>
}

export class YjsRoom implements DurableObject {
  private readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)
  private readonly conns = new Map<WebSocket, ConnState>()
  /** 本房间 docName（首个请求写入），出站消息头使用 */
  private roomName: string | null = null
  /** 当前落盘的分片数，用于清理收缩后的残留分片 */
  private persistedChunkCount = 0

  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {
    // 在处理任何请求前恢复持久化状态
    void this.state.blockConcurrencyWhile(async () => {
      await this.loadPersisted()
    })

    this.doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
  }

  // WebSocket 升级路径无 await，但 DurableObject 接口要求返回 Promise
  // eslint-disable-next-line @typescript-eslint/require-await
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const url = new URL(request.url)
    const match = /^\/ws\/(.+)$/.exec(url.pathname)
    const docName = match?.[1] ? decodeURIComponent(match[1]) : null
    if (!docName) {
      return new Response('Room ID required', { status: 400 })
    }
    this.roomName = docName

    const pair = new WebSocketPair()
    const pairSockets = Object.values(pair) as [WebSocket, WebSocket]
    const client = pairSockets[0]
    const server = pairSockets[1]
    server.accept()

    this.conns.set(server, { controlledIds: new Set() })

    // 新连接立即下发当前 awareness 快照（presence 无需等待下一次变更）
    if (this.awareness.getStates().size > 0) {
      this.send(server, this.encodeAwarenessMessage(Array.from(this.awareness.getStates().keys())))
    }

    server.addEventListener('message', (event) => {
      if (typeof event.data === 'string') return
      try {
        this.handleMessage(event.data as ArrayBuffer, server)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[yjs-room] message handling error:', err)
      }
    })
    server.addEventListener('close', () => this.handleClose(server))
    server.addEventListener('error', () => this.handleClose(server))

    return new Response(null, { status: 101, webSocket: client ?? null })
  }

  /** 防抖落盘：写入当前全量快照（分片存储，单次 put 保证原子性） */
  async alarm(): Promise<void> {
    const snapshot = Y.encodeStateAsUpdate(this.doc)
    const chunkCount = Math.max(1, Math.ceil(snapshot.byteLength / PERSIST_CHUNK_SIZE))

    const values: Record<string, Uint8Array | DocMeta> = {
      [META_KEY]: { chunkCount },
    }
    for (let i = 0; i < chunkCount; i++) {
      values[`${CHUNK_PREFIX}${i}`] = snapshot.slice(
        i * PERSIST_CHUNK_SIZE,
        (i + 1) * PERSIST_CHUNK_SIZE,
      )
    }
    await this.state.storage.put(values)

    // 清理文档收缩后的残留分片（失败无害：加载只按 meta.chunkCount 读取）
    if (this.persistedChunkCount > chunkCount) {
      const stale: string[] = []
      for (let i = chunkCount; i < this.persistedChunkCount; i++) {
        stale.push(`${CHUNK_PREFIX}${i}`)
      }
      await this.state.storage.delete(stale)
    }
    this.persistedChunkCount = chunkCount
  }

  // ---- 协议处理 ----

  private handleMessage(data: ArrayBuffer, ws: WebSocket): void {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    const documentName = decoding.readVarString(decoder)
    // 路由一致性校验：消息内 docName 必须与 DO 所在房间一致
    if (this.roomName !== null && documentName !== this.roomName) return

    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case MESSAGE_SYNC: {
        // 复用 y-protocols：SyncStep1 → 编码器追加 SyncStep2；Step2/Update → 直接应用
        const encoder = encoding.createEncoder()
        encoding.writeVarString(encoder, this.roomName ?? documentName)
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        const headerLength = encoding.length(encoder)
        const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws)

        if (encoding.length(encoder) > headerLength) {
          this.send(ws, encoding.toUint8Array(encoder))
        }
        if (syncType === syncProtocol.messageYjsSyncStep1) {
          // 镜像 Hocuspocus 服务端行为：回 SyncStep2 后反向下发 SyncStep1，
          // 向客户端请求其状态（新房间冷启动必需）。
          // 注意：必须用 Sync(0) 封装，2.15.x 客户端不识别 SyncReply(4)。
          this.send(ws, this.encodeSyncStepOneMessage())
        } else {
          // SyncStep2/Update：发送 SyncStatus ack，维持 provider 的 unsyncedChanges 计数
          this.send(ws, this.encodeSyncStatusMessage(true))
        }
        break
      }
      case MESSAGE_AWARENESS: {
        applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws)
        break
      }
      case MESSAGE_QUERY_AWARENESS: {
        this.send(ws, this.encodeAwarenessMessage(Array.from(this.awareness.getStates().keys())))
        break
      }
      case MESSAGE_CLOSE: {
        ws.close(1000, 'provider_initiated')
        break
      }
      default:
        // Auth(2)/Stateless(5) 等本服务未启用，忽略
        break
    }
  }

  /** 文档更新：广播给除 origin 外的所有连接，并调度防抖落盘 */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return
    this.schedulePersist()
    const buf = this.encodeUpdateMessage(update)
    for (const [conn] of this.conns) {
      if (conn !== origin) this.send(conn, buf)
    }
  }

  /** awareness 更新：记录归属连接并广播给其他连接 */
  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin instanceof WebSocket) {
      const conn = this.conns.get(origin)
      if (conn) {
        for (const id of changes.added) conn.controlledIds.add(id)
        for (const id of changes.removed) conn.controlledIds.delete(id)
      }
    }
    const changed = [...changes.added, ...changes.updated, ...changes.removed]
    if (changed.length === 0) return
    const buf = this.encodeAwarenessMessage(changed)
    for (const [conn] of this.conns) {
      if (conn !== origin) this.send(conn, buf)
    }
  }

  private handleClose(ws: WebSocket): void {
    if (!this.conns.has(ws)) return
    const conn = this.conns.get(ws)
    this.conns.delete(ws)
    if (!conn) return

    // 清理该连接的 presence（触发 awareness update 广播 removal）
    if (conn.controlledIds.size > 0) {
      removeAwarenessStates(this.awareness, Array.from(conn.controlledIds), 'connection-closed')
    }
    // 最后一个连接断开：调度落盘
    if (this.conns.size === 0) {
      this.schedulePersist()
    }
  }

  // ---- 消息编码 ----

  private encodeSyncStepOneMessage(): Uint8Array {
    const encoder = encoding.createEncoder()
    encoding.writeVarString(encoder, this.roomName ?? '')
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    return encoding.toUint8Array(encoder)
  }

  private encodeUpdateMessage(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder()
    encoding.writeVarString(encoder, this.roomName ?? '')
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    return encoding.toUint8Array(encoder)
  }

  private encodeAwarenessMessage(clients: number[]): Uint8Array {
    const encoder = encoding.createEncoder()
    encoding.writeVarString(encoder, this.roomName ?? '')
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, clients))
    return encoding.toUint8Array(encoder)
  }

  private encodeSyncStatusMessage(applied: boolean): Uint8Array {
    const encoder = encoding.createEncoder()
    encoding.writeVarString(encoder, this.roomName ?? '')
    encoding.writeVarUint(encoder, MESSAGE_SYNC_STATUS)
    encoding.writeVarUint(encoder, applied ? 1 : 0)
    return encoding.toUint8Array(encoder)
  }

  // ---- 持久化 ----

  private async loadPersisted(): Promise<void> {
    const meta = await this.state.storage.get<DocMeta>(META_KEY)
    if (!meta || meta.chunkCount <= 0) return

    const chunks: Uint8Array[] = []
    for (let i = 0; i < meta.chunkCount; i++) {
      const chunk = await this.state.storage.get<Uint8Array>(`${CHUNK_PREFIX}${i}`)
      if (!chunk) break
      chunks.push(chunk)
    }
    this.persistedChunkCount = chunks.length
    if (chunks.length === 0) return

    const total = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) {
      total.set(chunk, offset)
      offset += chunk.byteLength
    }
    Y.applyUpdate(this.doc, total, LOAD_ORIGIN)
  }

  private schedulePersist(): void {
    void this.state.storage
      .getAlarm()
      .then((alarm) => {
        if (alarm === null) {
          return this.state.storage.setAlarm(Date.now() + PERSIST_DEBOUNCE_MS)
        }
        return undefined
      })
      .catch(() => {
        // alarm 调度失败时静默：下一次更新会再次尝试
      })
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      ws.send(data)
    } catch {
      this.handleClose(ws)
    }
  }
}
