// @aether/converge-server · Converge Telemetry 指标定义
// 对齐 docs/roadmap/risks.md 风险 1 / 2 / 6 监控指标：
//   风险 1 连接成功率 / 持久化延迟 → converge_connections_total / converge_persist_seconds
//   风险 2 冷启动 P95 → converge_cold_start_seconds
//   风险 6 重复操作率 / 冲突率 → converge_persist_duplicates_total / converge_crdt_apply_failures_total
// 全局单例 registry，供 /metrics 端点 scrape；未配置时 disabled（no-op）。
import {
  createMetricsRegistry,
  type MetricsRegistry,
} from '@aether/observability'

const COLD_START_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const
const PERSIST_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1] as const

export interface ConvergeMetrics {
  registry: MetricsRegistry
  connectionsTotal: ReturnType<MetricsRegistry['counter']>
  coldStartSeconds: ReturnType<MetricsRegistry['histogram']>
  persistSeconds: ReturnType<MetricsRegistry['histogram']>
  persistDuplicatesTotal: ReturnType<MetricsRegistry['counter']>
  crdtApplyFailuresTotal: ReturnType<MetricsRegistry['counter']>
}

function buildConvergeMetrics(enabled: boolean): ConvergeMetrics {
  const registry = createMetricsRegistry({ enabled })
  return {
    registry,
    connectionsTotal: registry.counter({
      name: 'converge_connections_total',
      help: 'Hocuspocus connection count by outcome status',
      labelNames: ['status'],
    }),
    coldStartSeconds: registry.histogram({
      name: 'converge_cold_start_seconds',
      help: 'Y.Doc cold start load latency in seconds (onLoadDocument)',
      buckets: COLD_START_BUCKETS,
    }),
    persistSeconds: registry.histogram({
      name: 'converge_persist_seconds',
      help: 'CRDT update persistence latency in seconds (onChange appendCrdtUpdate)',
      buckets: PERSIST_BUCKETS,
    }),
    persistDuplicatesTotal: registry.counter({
      name: 'converge_persist_duplicates_total',
      help: 'Duplicate CRDT updates dropped by idempotency key',
    }),
    crdtApplyFailuresTotal: registry.counter({
      name: 'converge_crdt_apply_failures_total',
      help: 'CRDT applyUpdate failures during cold start (conflict / corruption)',
    }),
  }
}

let globalMetrics: ConvergeMetrics | null = null

/**
 * 全局 Converge Telemetry 单例。
 * 首次调用时按 AETHER_CONVERGE_TELEMETRY_DISABLED 决定 enabled。
 * Vercel Function / 独立进程共享同一实例。
 */
export function getConvergeMetrics(): ConvergeMetrics {
  if (globalMetrics === null) {
    const disabled =
      process.env.AETHER_CONVERGE_TELEMETRY_DISABLED === '1' ||
      process.env.AETHER_CONVERGE_TELEMETRY_DISABLED === 'true'
    globalMetrics = buildConvergeMetrics(!disabled)
  }
  return globalMetrics
}

/** 测试 / 显式注入用：重置全局单例。 */
export function resetConvergeMetrics(): void {
  globalMetrics = null
}

/** 测试用：构造独立 metrics 实例（不触碰全局单例）。 */
export function createConvergeMetrics(enabled = true): ConvergeMetrics {
  return buildConvergeMetrics(enabled)
}
