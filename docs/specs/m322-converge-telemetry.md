# Spec: M3.22 — Converge Telemetry 采集上线

`@aether/observability` 包从空占位落地为可用的指标层，在 converge-server
的 Hocuspocus 钩子埋点，expose Prometheus 文本格式 `/metrics` 端点。为
[risks.md](../roadmap/risks.md) 风险 1 / 2 / 6 的监控指标提供采集基础，
解锁 M3 性能优化的客观评估能力。

## 定位

- **可观测性层落地**：`@aether/observability` 提供 Counter / Histogram /
  MetricsRegistry 原语与 Prometheus 文本导出，纯内存无外部依赖（serverless
  友好，每实例独立采集）。
- **converge-server 埋点**：在 Y.Doc 生命周期的三个钩子记录指标：
  1. `onLoadDocument`：冷启动加载延迟（风险 2）
  2. `onChange`：持久化延迟 + 幂等键命中重复操作（风险 1 / 6）
  3. `onDisconnect`：连接计数（风险 1 连接成功率）
- **导出端点**：converge-server `/metrics`（Prometheus 文本格式），供
  Prometheus / Grafana / Vercel Log Drains scrape。

## 指标目录

对齐 [risks.md](../roadmap/risks.md) 监控指标：

| 指标 | 类型 | 标签 | 采集点 | 对应风险 |
|---|---|---|---|---|
| `converge_connections_total` | counter | `status`=`success`\|`failure` | onDisconnect | 风险 1 连接成功率 |
| `converge_cold_start_seconds` | histogram | — | onLoadDocument | 风险 2 冷启动 P95 |
| `converge_persist_seconds` | histogram | — | onChange | 风险 1 持久化延迟 P95 |
| `converge_persist_duplicates_total` | counter | — | onChange 幂等键命中 | 风险 6 重复操作率 |
| `converge_crdt_apply_failures_total` | counter | — | onLoadDocument applyUpdate 失败 | 风险 6 冲突率 |

Histogram bucket（秒）：
- `converge_cold_start_seconds`：0.05 / 0.1 / 0.25 / 0.5 / 1 / 2.5 / 5 / +Inf
- `converge_persist_seconds`：0.01 / 0.05 / 0.1 / 0.25 / 0.5 / 1 / +Inf

## 交付内容

### 1. `@aether/observability` 指标原语

- `Counter`：单调递增，支持 label 维度；`inc(value?, labels?)`
- `Histogram`：延迟分布，固定 bucket；`observe(value, labels?)`，
  暴露 `_bucket{le=}` / `_sum` / `_count`
- `MetricsRegistry`：注册指标、`render()` 输出 Prometheus 文本格式
- 纯内存、线程安全（单线程 Node，无需锁），无 I/O

### 2. converge-server 埋点

- `AetherDatabaseExtension` 注入 `MetricsRegistry`：
  - `onLoadDocument`：计时 → `converge_cold_start_seconds.observe(elapsed)`；
    `applyUpdate` 失败 → `converge_crdt_apply_failures_total.inc()`
  - `onChange`：计时 `appendCrdtUpdate` → `converge_persist_seconds.observe(elapsed)`；
    幂等键命中（返回空）→ `converge_persist_duplicates_total.inc()`
- `createHocuspocus`：`onDisconnect` → `converge_connections_total.inc({status})`

### 3. `/metrics` 导出端点

- converge-server Vercel Function `api/metrics.ts`：GET 返回
  `text/plain; version=0.0.4`（Prometheus 文本格式），复用全局 registry。
- 独立进程模式 `src/index.ts`：http server 路由 `/metrics`。

## 实现约束

- **纯内存指标**：无外部依赖（不引 prom-client 等），serverless 每实例独立
  采集；跨实例聚合由 Prometheus scrape 或 Log Drains 外部完成。
- **零运行时开销可关停**：registry 可设 `enabled: false`，所有 inc/observe
  no-op（测试 / 开发环境）。
- **不破坏现有行为**：埋点为纯增量，`AetherDatabaseExtension` 未注入
  registry 时行为不变（向后兼容）。
- **Prometheus 文本格式合规**：`# HELP` / `# TYPE` 头、label 转义、
  histogram bucket 顺序、`+Inf` 桶。

## 不在本次范围

- web serverless 冷启动指标（Vercel Function 实例短暂，单实例 P95 无意义，
  需 Log Drains 外部聚合，留后续）
- 告警规则 / Grafana dashboard 配置（属运维交付）
- 指标推送（Pushgateway）— serverless scrape 模型已够用
- 连接池复用率（风险 2）— 需 Drizzle / Neon pooler 暴露内部指标，留后续

## 验收标准

- [ ] `@aether/observability` 导出 Counter / Histogram / MetricsRegistry，
      Prometheus 文本格式合规
- [ ] converge-server 三个钩子埋点：冷启动延迟 / 持久化延迟 / 连接计数
- [ ] `/metrics` 端点返回 Prometheus 文本格式
- [ ] `pnpm typecheck` / `lint` / `test` / `build` 全绿；文档同步
