# Plan: M3.18 — 内部功能 API 化改造（API-First 兑现）

Spec: [m318-internal-api-first.md](./m318-internal-api-first.md)

## 实施顺序

1. **core.ts（新建 `apps/@aether/web/lib/resonance/core.ts`）**
   - CoreActor / CoreResult / 错误码类型；
   - requireThreadRow、coreCreateThread、corePatchThread、coreAppendDialogue；
   - 从 service.ts 原样搬运事务体（insert / update / dialogue_ref 竞争回写 /
     审计 / outbox 入队），幂等键前缀改通道 source。
2. **service.ts 重构**
   - handleCreateThread / handlePatchThread / handleCreateDialogue 改薄委托；
   - CoreError → HTTP 映射；删除内联 ThreadRow / requireThread（改用 core 导出）；
   - 读 handler 的 requireThread 换 requireThreadRow。
   - 行为差异（可接受）：PATCH / POST dialogue 的入参校验（400）先于资源
     存在性（404）——与「先验输入后查资源」的通用惯例一致。
3. **lib/threads.ts 会话通道**
   - createThread 消费 coreCreateThread；actor = resolveCurrentActor() 回退
     web-client；source='session'；返回形状不变。
4. **lib/github-webhook.ts 集成通道**
   - db 类型收紧；installationId 下传各 handler；五路径改走 core；
   - 非法迁移容忍忽略（ignored + warn 日志）；标题镜像保持直接写。
5. **测试**
   - resonance-service.test.ts：现有断言应全部兼容（mock 队列消费顺序不变）；
   - 新增 tests/thread-action.test.ts（会话审计 / 回退 actor / 失败传播）；
   - 新增 tests/github-webhook.test.ts（五路径 + archived 拒绝迁移 + 事件入队）。
6. **门禁 + 文档**
   - pnpm typecheck / lint / test / build 全绿；
   - README 架构段、docs/README.md 索引（31/32）、milestones.md 勾选与备注。

## 文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `apps/@aether/web/lib/resonance/core.ts` |
| 修改 | `apps/@aether/web/lib/resonance/service.ts`（三写端点薄委托） |
| 修改 | `apps/@aether/web/lib/threads.ts`（会话通道消费 core） |
| 修改 | `apps/@aether/web/lib/github-webhook.ts`（集成通道消费 core） |
| 新建 | `apps/@aether/web/tests/thread-action.test.ts` |
| 新建 | `apps/@aether/web/tests/github-webhook.test.ts` |
| 修改 | `README.md` |
| 修改 | `docs/README.md` |
| 修改 | `docs/roadmap/milestones.md` |
| 新建 | `docs/specs/m318-internal-api-first.md` |
| 新建 | `docs/specs/m318-plan.md` |

## 风险与对策

- **mock 队列错位**（重构后查询顺序变化导致测试假绿/假红）：core 搬运时
  保持查询顺序；跑全量测试核对。
- **GitHub 行为变化**（closed on archived 不再强写 resolved）：spec 已声明
  为有意变更（人工归档优先），ignored 响应保证桥接存活。
- **幂等键前缀变化**：无唯一约束依赖特定前缀；行级 id / UUID 保证唯一。
