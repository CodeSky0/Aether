// @aether/converge-server · Aether Database Extension
// 接入 @aether/db 的 crdt_updates 表，实现 Hocuspocus 的文档持久化。
//
// 持久化策略（遵循探测文档推荐形态）：
// - onChange: 实时追加增量 update 到 crdt_updates（每条编辑都落库）
// - onLoadDocument: 冷启动时读取所有增量合并成全量状态应用到 Document
// - onStoreDocument: no-op（增量已由 onChange 实时追加，全量快照压实留待后续优化）
//
// 与 @aether/web Server Actions 通道共享同一个 Postgres 数据源，
// Hocuspocus 是权威实时通道，Server Actions 是降级非权威通道。
import type { Extension, onChangePayload, onLoadDocumentPayload } from '@hocuspocus/server'
import {
  appendCrdtUpdate,
  readCrdtUpdatesSince,
  type UpdateLogDb,
} from '@aether/db'
import type { ActorType } from '@aether/types'
import { applyUpdate } from 'yjs'
import { parseDocumentName } from '../document-name.js'
import type { ConvergeMetrics } from '../telemetry.js'

/** 单次读取增量的分页大小（防止极端情况下的 OOM） */
const LOAD_PAGE_SIZE = 10_000

export interface AetherDatabaseExtensionOptions {
  /** drizzle 实例（测试时注入 mock；运行时用 getDb()） */
  db: UpdateLogDb
  /** 默认 actorType（后续 M2 auth extension 可从 context 提取真实身份） */
  actorType?: ActorType
  /** 默认 actorId */
  actorId?: string
  /** Converge Telemetry 指标（可选；未注入时无埋点，行为不变） */
  metrics?: ConvergeMetrics
}
/**
 * Aether Database Extension for Hocuspocus。
 * 把 Yjs 文档变更持久化到 @aether/db 的 crdt_updates 表。
 */
export class AetherDatabaseExtension implements Extension {
  public readonly extensionName = 'aether-database'
  private readonly db: UpdateLogDb
  private readonly defaultActorType: ActorType
  private readonly defaultActorId: string
  private readonly metrics: ConvergeMetrics | undefined
  private idempotencyCounter = 0
  public constructor(options: AetherDatabaseExtensionOptions) {
    this.db = options.db
    this.defaultActorType = options.actorType ?? 'entity'
    this.defaultActorId = options.actorId ?? 'hocuspocus-server'
    this.metrics = options.metrics
  }
  /**
   * 冷启动：读取所有增量合并成全量状态应用到 Document。
   * Hocuspocus 在首次加载文档时调用。
   */
  public async onLoadDocument(
    data: onLoadDocumentPayload,
  ): Promise<void> {
    const { realmId, docRef } = parseDocumentName(data.documentName)
    const start = performance.now()
    // P2-14 修复：循环翻页加载全部增量，不再静默截断前 10000 条
    let afterSeq = 0
    let totalLoaded = 0
    while (true) {
      const records = await readCrdtUpdatesSince(this.db, realmId, docRef, {
        afterSeq,
        limit: LOAD_PAGE_SIZE,
      })
      if (records.length === 0) break
      for (const record of records) {
        try {
          applyUpdate(data.document, record.payload)
        } catch {
          this.metrics?.crdtApplyFailuresTotal.inc()
          throw new Error(
            `Failed to apply CRDT update seq=${record.seq} for ${docRef}`,
          )
        }
      }
      totalLoaded += records.length
      afterSeq = records[records.length - 1]!.seq
      if (records.length < LOAD_PAGE_SIZE) break
    }
    if (totalLoaded >= LOAD_PAGE_SIZE) {
      // eslint-disable-next-line no-console
      console.warn(
        `[converge-server] Loaded ${totalLoaded} updates for ${docRef}; ` +
          'consider compacting the document to a snapshot for faster cold starts.',
      )
    }
    this.metrics?.coldStartSeconds.observe((performance.now() - start) / 1000)
  }
  /**
   * 实时追加：每条编辑的增量 update 落库到 crdt_updates。
   * Hocuspocus 在文档变更时调用（每条 update 触发一次）。
   */
  public async onChange(
    data: onChangePayload,
  ): Promise<void> {
    const { realmId, docRef } = parseDocumentName(data.documentName)
    const actor = this.resolveActor(data)
    const start = performance.now()
    const inserted = await appendCrdtUpdate(this.db, realmId, {
      docRef,
      payload: data.update,
      actorType: actor.actorType,
      actorId: actor.actorId,
      idempotencyKey: this.generateIdempotencyKey(data.socketId),
    })
    this.metrics?.persistSeconds.observe((performance.now() - start) / 1000)
    if (inserted === null) {
      this.metrics?.persistDuplicatesTotal.inc()
    }
  }
  /**
   * 解析 actor 身份。
   * M1 阶段使用默认值；后续 M2 auth extension 可从 data.context 提取真实身份。
   */
  private resolveActor(
    data: onChangePayload,
  ): { actorType: ActorType; actorId: string } {
    const context = data.context as
      | { actorType?: ActorType; actorId?: string }
      | undefined
    if (context?.actorType && context?.actorId) {
      return {
        actorType: context.actorType,
        actorId: context.actorId,
      }
    }
    return {
      actorType: this.defaultActorType,
      actorId: this.defaultActorId,
    }
  }
  /**
   * 生成幂等键：hocuspocus:{socketId}:{timestamp}:{counter}
   * socketId 标识来源连接，timestamp + counter 保证唯一性。
   */
  private generateIdempotencyKey(socketId: string): string {
    this.idempotencyCounter += 1
    return `hocuspocus:${socketId || 'direct'}:${Date.now()}:${this.idempotencyCounter}`
  }
}
