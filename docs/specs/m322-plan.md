# Plan: M3.22 — Converge Telemetry 采集上线

Spec: [m322-converge-telemetry.md](./m322-converge-telemetry.md)

## 实施顺序

1. **`@aether/observability` 指标原语** `src/index.ts`
   - `Counter`：`inc(value?, labels?)`，label 维度按注册时声明
   - `Histogram`：`observe(value, labels?)`，固定 bucket，暴露 `_bucket` /
     `_sum` / `_count`
   - `MetricsRegistry`：`counter()` / `histogram()` 注册，`render()` 输出
     Prometheus 文本格式（`# HELP` / `# TYPE` / label 转义 / bucket 顺序）
   - `enabled: false` 时全部 no-op
2. **observability 单测** `src/__tests__/metrics.test.ts`
   - Counter inc / label 维度 / 单调性
   - Histogram observe / bucket 计数 / sum / count
   - Registry render Prometheus 文本格式合规
   - disabled 模式 no-op
3. **converge-server 埋点**
   - `AetherDatabaseExtension` 构造注入可选 `registry: MetricsRegistry`
   - `onLoadDocument`：计时 + applyUpdate 失败计数
   - `onChange`：计时 appendCrdtUpdate + 幂等键命中计数
   - `createHocuspocus`：`onDisconnect` 连接计数
   - 未注入 registry 时行为不变（向后兼容）
4. **`/metrics` 端点**
   - `api/metrics.ts`：GET → `text/plain; version=0.0.4`，复用全局 registry
   - 独立进程 `src/index.ts`：http server 路由 `/metrics`
5. **converge-server 埋点单测**
   - `tests/telemetry.test.ts`：onLoadDocument / onChange / onDisconnect 记录指标
6. **门禁 + 文档**：milestones 勾选、docs/README 索引、spec 验收标准

## 文件清单

| 操作 | 路径 |
|------|------|
| 修改 | `packages/@aether/observability/src/index.ts` |
| 新建 | `packages/@aether/observability/src/__tests__/metrics.test.ts` |
| 修改 | `packages/@aether/observability/package.json`（vitest） |
| 修改 | `apps/@aether/converge-server/src/extensions/database.ts`（埋点） |
| 修改 | `apps/@aether/converge-server/src/hocuspocus.ts`（onDisconnect 埋点） |
| 新建 | `apps/@aether/converge-server/src/telemetry.ts`（registry + 指标定义） |
| 新建 | `apps/@aether/converge-server/api/metrics.ts`（导出端点） |
| 修改 | `apps/@aether/converge-server/src/vercel.ts`（/metrics 路由） |
| 新建 | `apps/@aether/converge-server/tests/telemetry.test.ts` |
| 新建 | `docs/specs/m322-converge-telemetry.md` |
| 新建 | `docs/specs/m322-plan.md` |
| 修改 | `docs/README.md`（索引 39/40） |
| 修改 | `docs/roadmap/milestones.md`（M3.22 勾选 + 备注） |

## 风险与对策

- **埋点性能开销**：每次 onChange 计时 + inc 可能影响吞吐。对策：registry
  `enabled: false` 可关停；计时用 `performance.now()` 单调时钟；inc/observe
  纯内存写，纳秒级。
- **Prometheus 文本格式合规**：label 值含特殊字符需转义。对策：实现
  `escapeLabelValue`（转义 `\` / `"` / `\n`），单测覆盖。
- **向后兼容**：`AetherDatabaseExtension` 现有调用方未传 registry。对策：
  registry 参数可选，未注入时跳过所有埋点（行为不变）。
- **serverless 实例隔离**：每 Vercel Function 实例独立 registry，scrape 只
  得单实例快照。对策：文档注明跨实例聚合由 Prometheus 多 target scrape 或
  Log Drains 完成，本里程碑交付单实例采集能力。
