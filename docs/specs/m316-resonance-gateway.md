# Spec: M3.16 — Resonance Gateway（公开 REST API v1）

M3「Resonance Gateway：全资源公开 API」的落地步，也是 API-First 主张的第一个验收载体。
现状：`api_keys` 表与设置面板（生成 / 吊销）已就绪，但密钥生成后无任何可调用端点——
第三方应用（CLI、CI、IDE 插件、Entity 运行时）没有进入 Aether 的入口。本任务交付
`/api/v1` 公开 REST API，覆盖 Realm、Project、Thread、Dialogue、Entity、Current
核心资源，鉴权复用既有 API Key 体系。

## 现状与缺口

1. 内部功能（Realm / Thread / Entity / Current 查询与写入）全部走 Server Actions +
   会话守卫（`resolveCurrentActor` / `requireRealmAccess`），无会话的第三方应用无法调用。
2. `api_keys` 表（sha256 哈希 + 前缀 + 软吊销 + realm 绑定）与 `lib/api-keys.ts`
   Server Actions、设置面板已在 Phase Shift / M3.12 交付，但只存不用。
3. SCIM（M3.15）已建立 config / protocol / service 三层分层范式，Gateway 沿用该范式；
   Server Action 层与会话耦合（`next/headers`），Gateway 不能直接复用，业务查询在
   service 层自持（与 SCIM 先例一致）。「内部功能改为消费公开 API」是独立任务
   （M3.17，API-First 收口），不在本 spec 范围。

## 交付内容

### 1. 鉴权与主体模型

- `Authorization: Bearer aeth_<base64url>`；解析后 sha256 哈希 → `api_keys.key_hash`
  唯一索引查找（`revoked_at IS NULL`）。哈希后索引查找，无明文比对，无时序侧信道。
- 失败返回 401 `{ error: { code: "unauthorized", message } }` + `WWW-Authenticate: Bearer`。
- **密钥即服务主体**：v1 密钥授予其绑定 Realm 的 member 级权限（读全部资源 + 写
  Thread / Dialogue），管理操作（成员、密钥、集成管理）不在公开 API 暴露。
- **fail-closed 三重校验**（任一失败即 401/404）：
  1. 密钥存在且未吊销；
  2. 绑定 Realm 未软删除；
  3. 密钥创建者仍是该 Realm 的 active human member（防「SCIM 回收成员后密钥残留」；
     对齐业界惯例——凭据随创建者离场而失效）。
- `last_used_at` 每次成功鉴权后更新（按主键的小更新，await 完成）。
- **跨 Realm 一律 404**：路径 realmId ≠ 密钥绑定 Realm、或资源属于其他 Realm 时，
  不向调用方泄露其他 Realm 的存在性（对齐 GitHub 语义）。
- 密钥管理（生成 / 吊销）仅会话通道可达：泄露的密钥无法自我复制。

### 2. 端点（`/api/v1`，Route Handler）

| 方法 / 路径 | 语义 |
|---|---|
| `GET /api/v1` | 端点自描述（发现入口，含版本与资源链接） |
| `GET /api/v1/realms` | 密钥绑定 Realm（单元素数组） |
| `GET /api/v1/realms/{realmId}` | Realm 详情 |
| `GET /api/v1/realms/{realmId}/projects` | Project 列表（创建 Thread 需要 projectId） |
| `GET /api/v1/realms/{realmId}/threads` | Thread 列表；`status` 过滤 + `limit`(默认 30，max 100) / `offset` 分页 |
| `POST /api/v1/realms/{realmId}/threads` | 创建 Thread：`project_id`、`title`（1–200）、`manifestation_url?`、`code_anchor?`（≤10000） |
| `GET /api/v1/threads/{threadId}` | Thread 详情（含 `code_anchor` 与 `dialogue_ref`） |
| `PATCH /api/v1/threads/{threadId}` | `status` 状态迁移；`manifestation_url` 绑定（字符串）/ 解绑（null）/ 不变（缺省） |
| `GET /api/v1/threads/{threadId}/dialogues` | 对话历史；`after=<seq>` 游标 + `limit`，按 seq 升序 |
| `POST /api/v1/threads/{threadId}/dialogues` | 追加消息：`role`（`user` / `assistant`，默认 `user`）、`content`（1–20000） |
| `GET /api/v1/realms/{realmId}/entities` | Entity 列表（id / display_name / status / 时间戳） |
| `GET /api/v1/realms/{realmId}/currents` | Current 列表（doc_ref / connection_state / presence_snapshot / updated_at） |

### 3. 关键语义

- **Thread 状态机**（非法迁移 400 `invalid_status_transition`）：
  `open → in_review | resolved`；`in_review → open | resolved`；
  `resolved → archived | open`（reopen）；`archived → open`（reopen）。
- **Dialogue 追加**：`threads.dialogue_ref` 为空时生成新 `dialogue_id` 并回写该行，
  之后消息挂同一 dialogue；消息 `actor_type='human'`、`actor_id=created_by`（密钥
  创建者归因），`metadata.via='api-key'` + 密钥名；seq 由 bigserial 全序保证。
- **审计**（写操作与业务变更同事务落账，幂等键 `resonance:<op>:<...>` 前缀）：
  Thread 创建 / 状态迁移 → `action='write'`；Dialogue 追加 → `action='converse'`；
  actor 沿 SCIM 服务主体惯例：`{ actor_type: 'entity', actor_id: 'api-key:<keyId>' }`。
  读操作 v1 不审计（与 SCIM 一致，读审计随 Audit Vault 读路径策略另议）。
- **响应约定**：资源字段 snake_case（与 DB / SCIM 一致）；时间戳 ISO 8601；
  列表响应 `{ data: [...], pagination: { total, limit, offset } }`，dialogue 游标分页
  为 `{ data: [...], pagination: { next_after, limit } }`；错误体
  `{ error: { code, message } }`；content-type `application/json`。

### 4. 实现分层（沿 M3.15 SCIM 范式）

- `lib/resonance/auth.ts` — Bearer 解析、哈希查找、fail-closed 校验、`last_used_at` 维护；
- `lib/resonance/protocol.ts` — 纯函数：错误响应、资源映射、分页解析、zod 输入
  schema、状态机判定。不接触 db，全部可单测；
- `lib/resonance/service.ts` — 业务 handler：鉴权 → Realm/资源守卫 → 业务 → 审计。
  路由层零业务逻辑；
- `app/api/v1/**` — thin route，仅解析 params 并透传。

## 不在本次范围

- 内部功能切换为消费公开 API（M3.17「内部功能 API 化改造」，Gateway 先行、改造收口）
- OAuth App Registry、Webhook Constellation（独立 spec，依赖本 Gateway）
- OpenAPI 文档自动生成（README 手写端点表，Marketplace 阶段再议）
- 密钥 scopes 细化（read-only 密钥）与多 Realm 密钥（`api_keys` 已预留扩展位）
- 请求限流（依赖部署平台 WAF / 网关层）
- CRDT 写通道 REST 化（Current 写入仍走 Hocuspocus WebSocket / Server Actions）
- 读操作审计、`Idempotency-Key` 请求级幂等

## 验收标准

- [ ] Bearer 鉴权：缺失 / 非 aeth 前缀 / 未知密钥 / 已吊销 → 401 + `WWW-Authenticate`
- [ ] fail-closed：创建者失去 active membership → 401；Realm 软删除 → 404
- [ ] 跨 Realm 访问（路径 realmId、资源归属）→ 404
- [ ] `GET/POST threads`：过滤、分页（limit 边界 clamp）、创建 201 + 审计 `write`
- [ ] `PATCH thread`：合法迁移 200、非法迁移 400、manifestation_url 绑定 / 解绑 / 缺省
- [ ] `POST dialogues`：首条消息回写 `dialogue_ref`、actor 归因创建者、审计 `converse`；
      role / content 校验 400
- [ ] `GET dialogues`：`after` 游标语义正确（> seq，升序）
- [ ] entities / currents / projects / realms 端点资源形状符合约定
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` 与 Web production build 全绿
- [ ] README 端点表、docs 索引、milestones 备注同步更新
