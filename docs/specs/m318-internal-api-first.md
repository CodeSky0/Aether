# Spec: M3.18 — 内部功能 API 化改造（API-First 兑现）

M3 出口条件：「独立第三方应用仅凭公开 API 完成一次完整协同闭环」之外的另一半
验收——**内部功能全部消费公开 API 的业务实现**，消灭同一业务操作的多份分叉
实现。M3.16 已交付公开 API（Resonance Gateway），M3.17 已交付出站事件
（Webhook Constellation）；本任务把会话通道（Server Actions）与 GitHub 集成
通道（Resonance Bridge）的业务写入统一收敛到公开 API 的业务核心层。

## 现状与缺口

同一业务操作目前最多存在三份实现，行为已发生分叉：

| 业务操作 | 公开 API（resonance service） | 会话通道（lib/threads.ts） | GitHub 集成（lib/github-webhook.ts） |
|---|---|---|---|
| Thread 创建 | 校验 + 审计 + `thread.created` 事件 | ⚠️ 独立实现：校验 + 事件，**无审计** | ⚠️ 直接写库：**无审计、无事件** |
| Thread 状态迁移 | 状态机 + 审计 + `thread.status_changed` | —（UI 暂无此操作） | ⚠️ 直接写库：**绕过状态机**（任意状态间跳转）、无审计、无事件 |
| manifestation_url 绑定 | 审计 | — | ⚠️ 直接写库：无审计 |
| Dialogue 追加 | dialogue_ref 竞争回写 + 审计 + 事件 | —（UI 暂无此操作） | ⚠️ 直接写库：dialogue_ref 非竞争回写（并发丢消息风险）、无审计、无事件 |

分叉的直接后果：审计台账回答不了「这条 Thread 是谁经哪个通道创建的」；
GitHub 通道可把 archived Thread 直接改成 resolved（人工归档被外部状态覆盖）；
GitHub 评论触发的外发 Webhook 事件缺失（订阅方看不到 GitHub 侧的对话）。

## 目标架构

```
                    ┌─ /api/v1 路由（API Key 鉴权）─┐
会话 Server Actions ┤                              ├─→ lib/resonance/core.ts（业务核心）
GitHub Webhook 桥  ─┘   （通道各自鉴权 / 输入校验）      ├ 校验业务规则（project 归属 / 状态机 / dialogue_ref 竞争）
                                                      ├ 审计（同事务，通道归因）
                                                      └ 事务性 outbox（Webhook 事件）
```

- **core 是唯一业务实现**：与主体无关（subject-agnostic）、与传输无关
  （不返回 Response、不感知会话 / API Key / HTTP）。
- **通道层只做三件事**：鉴权（API Key fail-closed / 会话守卫 / GitHub 签名）、
  入参校验（各自的 zod schema）、错误映射（CoreError → HTTP 400/404 或
  ActionResult failure / ignore）。

## 交付内容

### 1. 业务核心层 `lib/resonance/core.ts`

- **CoreActor**：`{ actorType, actorId, source }`——审计归因主体。
  `source ∈ {'api-key', 'session', 'github'}`，同时作为审计幂等键前缀。
- **CoreResult**：`{ ok: true, data } | { ok: false, code, message }`，
  错误码 `not_found` / `invalid_project` / `invalid_status_transition`。
- **coreCreateThread(db, { realmId, projectId, title, manifestationUrl?,
  codeAnchor?, actor })**：project 归属校验 → 事务内 insert + 审计
  （`action='write'`）+ `thread.created` 入队。`codeAnchor` 为结构化对象
  （API / 会话传 `{ selection }`，GitHub 传 issue anchor）。
- **corePatchThread(db, { threadId, realmId, status?, manifestationUrl?, actor })**：
  Thread 守卫 → 状态机校验 → 事务内 update + 审计 + 状态实际迁移时
  `thread.status_changed` 入队（同值 no-op 不发射）。
- **coreAppendDialogue(db, { threadId, realmId, role, content, actor,
  messageActor, metadata })**：审计主体（actor）与消息归因主体
  （messageActor）分离——API Key 场景审计记 `api-key:<id>`、消息归因创建者；
  dialogue_ref 空时竞争回写（并发首条消息幂等收敛）→ insert 消息 →
  Thread touch → 审计（`action='converse'`）+ `dialogue.message_created` 入队。
- **requireThreadRow(db, realmId, threadId)**：Realm 内未删除 Thread 守卫，
  供 core 与 service 共用。

### 2. 通道接入

- **公开 API（service.ts）**：`handleCreateThread` / `handlePatchThread` /
  `handleCreateDialogue` 改为薄委托（zod → core → CoreError 映射 HTTP），
  对外行为不变（错误码、响应体、状态机语义完全兼容）。错误映射：
  `not_found` → 404；`invalid_project` → 400 `bad_request`；
  `invalid_status_transition` → 400 `invalid_status_transition`。
- **会话通道（lib/threads.ts createThread）**：消费 coreCreateThread。
  **补齐审计缺口**：actor 取 `resolveCurrentActor()`，无会话时回退
  `('human', 'web-client')`（与 Current 通道回退一致）；source=`'session'`。
  返回形状 `{ id, title }` 不变（UI 零改动）。
- **GitHub 集成（lib/github-webhook.ts）**：全部业务写入改走 core，
  actor = `('entity', 'github:<installationId>', 'github')`：
  - issue opened/reopened（新）→ coreCreateThread（code_anchor 保留 issue
    anchor，获得审计 + 事件）；
  - issue reopened（已存在）→ 标题镜像 + corePatchThread(status='open')；
  - issue closed → corePatchThread(status='resolved')——**archived Thread 的
    迁移被状态机拒绝，通道容忍并忽略**（人工归档决策优先于 GitHub 状态，
    返回 `ignored` 而非 error，桥接不因外部状态噪音失败）；
  - issue_comment → coreAppendDialogue（消息归因 GitHub login，获得
    dialogue_ref 竞争回写 + 审计 + 事件；metadata 形状不变）；
  - pull_request → corePatchThread(manifestationUrl)（获得审计）。
  - `GithubWebhookContext.db` 类型收紧为 web Database（路由已传 `getDb()`）。

### 3. 审计与事件语义（统一后）

| 操作 | audit action | 审计 actor（source） | Webhook 事件 |
|---|---|---|---|
| Thread 创建 | `write` | 通道 CoreActor | `thread.created` |
| Thread 状态实际迁移 | `write` | 通道 CoreActor | `thread.status_changed` |
| manifestation_url 绑定/解绑 | `write` | 通道 CoreActor | —（非状态迁移） |
| Dialogue 追加 | `converse` | 通道 CoreActor | `dialogue.message_created` |

幂等键前缀从 `resonance:` 改为通道 source 前缀（`api-key:` / `session:` /
`github:`），行级 id / UUID 保证唯一性，语义更可读。

## 不在本次范围

- **读路径 API 化**（listThreads / listProjects 等）：会话读形状与 API 资源
  形状不同，且读操作无业务规则（无状态机 / 审计 / 事件），收敛无净收益；
  后续 UI 需要 API 形状时再议。
- CRDT 写通道（Current）REST 化：M3.16 已明确排除，权威通道是 Hocuspocus。
- 管理操作（成员 / 密钥 / 集成管理）API 化：明确不在公开 API 暴露面。
- GitHub 标题镜像走 core：标题同步是字段级 mirror，非业务状态操作，保持
  直接写库。
- OpenAPI 文档自动生成、请求级 `Idempotency-Key`。

## 验收标准

- [ ] core 层三操作 + requireThreadRow 落地，零 'use server' / 零 HTTP 耦合
- [ ] 公开 API 三写端点行为不变：现有 resonance-service 测试全绿（含状态机
      非法迁移 400、跨 Realm 404、审计归因）
- [ ] 会话 createThread：返回形状不变 + 新增审计（human actor、source=session）
      + thread.created 事件
- [ ] GitHub 桥：issue 创建 / closed / reopened / comment / PR 五路径全部
      走 core；closed→archived 迁移被状态机拒绝且桥接不崩（ignored）；
      comment 获得 dialogue_ref 竞争回写；全部写路径有审计与事件
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` 与 Web production build 全绿
- [ ] README（架构说明）、docs 索引、milestones 备注同步更新
