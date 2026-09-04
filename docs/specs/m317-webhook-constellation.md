# Spec: M3.17 — Webhook Constellation（出站事件订阅 / 签名 / 重试）

M3「Webhook Constellation：订阅、签名、重试」的落地步。M3.16 交付了 `/api/v1`
公开 REST API（主动拉），本任务交付出站事件推送（被动收）——第三方应用仅凭
公开 API 即可完成「调用 + 订阅」的完整协同闭环，兑现 M3 退出标准。

## 现状与缺口

1. M3.16 已落地 API Key 鉴权与核心资源端点，但第三方应用只能轮询；Thread 创建、
   状态迁移、对话追加等事件无法实时驱动外部工作流。
2. `@aether/resonance` 包已有 AES-GCM 凭据加密设施（`crypto.ts`，
   `AETHER_INTEGRATION_ENCRYPTION_KEY`），但无任何出站 webhook 代码。
3. 入站 GitHub webhook（`app/api/webhooks/github/route.ts`）已示范 HMAC-SHA256
   验签范式，出站签名采用对称镜像设计。
4. Serverless（Vercel Functions）无常驻 worker：投递需要「事务性 outbox +
   Cron 扫描」模式，不能依赖进程内异步队列。

## 交付内容

### 1. 数据模型（迁移 0005）

**`webhook_subscriptions`**（订阅）：
- `id` / `realm_id`（FK realms）/ `name`（展示名）/ `url`（仅 https）
- `events`（jsonb 数组）：事件类型目录子集，或 `["*"]` 通配全部
- `encrypted_secret`：AES-GCM 加密的签名密钥（base64(iv‖ct‖tag)），
  明文格式 `whsec_<base64url(32B)>` 仅创建时返回一次；另存 `secret_prefix`
  （前 12 字符）用于列表识别
- `created_by`（密钥创建者 Better-Auth user id）/ `created_at` / `updated_at`
- `deleted_at` 软删除（查询一律过滤）
- 索引：`realm_id`、`realm_id WHERE deleted_at IS NULL`

**`webhook_deliveries`**（投递，事务性 outbox）：
- `id` / `subscription_id`（FK）/ `realm_id`（FK，冗余便于隔离查询）
- `event_type`（text，目录内值）/ `payload`（jsonb，事件信封）
- `status`：`pending` → `succeeded` | `exhausted` | `canceled`
- `attempts`（已尝试次数）/ `next_attempt_at`（下次可投递时间）
- `last_response_status`（int）/ `last_error`（text，截断 500 字符）
- `created_at` / `delivered_at`
- 索引：`(status, next_attempt_at)`（扫描队列）、`(subscription_id, created_at)`
  （订阅方查询）、`realm_id`

### 2. 事件目录（v1）

| 事件类型 | 触发点 | data 字段 |
|---|---|---|
| `thread.created` | Gateway 创建 Thread / 会话 createThread | `thread_id` `project_id` `title` |
| `thread.status_changed` | Gateway PATCH 状态实际迁移时 | `thread_id` `from` `to` |
| `dialogue.message_created` | Gateway 追加对话消息 | `thread_id` `dialogue_id` `message_id` `seq` `role` |

- 事件信封：`{ type, created_at, realm: { id, slug }, data }`；时间戳 ISO 8601。
- 载荷只含引用与描述符（lean payload），消息正文等大字段由订阅方经
  `/api/v1` 按需拉取。
- GitHub 入站 webhook 创建的 Thread（`lib/github-webhook.ts`）v1 不发射事件
  （该路径为裸 insert，改造涉及独立同步语义，留待后续收口）。

### 3. 订阅管理（API Key member 级，沿用 M3.16 鉴权）

| 方法 / 路径 | 说明 |
|---|---|
| `GET /api/v1/realms/{realmId}/webhooks` | 订阅列表（含 `secret_prefix`，不含明文） |
| `POST /api/v1/realms/{realmId}/webhooks` | 创建订阅（`name` / `url` / `events`）→ 201 + `secret` 明文仅此一次 |
| `DELETE /api/v1/webhooks/{subscriptionId}` | 软删除 → 204 |
| `GET /api/v1/webhooks/{subscriptionId}/deliveries` | 投递历史（`limit`/`offset` 分页） |

- 权限定性：member 级 API Key 已可读全部 Realm 资源、写 Thread / Dialogue；
  订阅事件载荷不超出其可读范围，目的 URL 由持密钥者自选，暴露面等价。
- 跨 Realm 访问一律 404（对齐 M3.16 语义）；订阅操作以 `api-key:<keyId>`
  服务主体落审计（action=`write`）。
- `url` 仅接受 https（杜绝明文回流出站）；`events` 至少一项且须在目录内或 `*`。

### 4. 签名协议（对齐 GitHub X-Hub-Signature-256 惯例）

每次投递 `POST` 订阅 URL，请求头：
- `x-aether-event`：事件类型
- `x-aether-delivery`：投递 id（接收方幂等去重键）
- `x-aether-hook-id`：订阅 id
- `x-aether-timestamp`：Unix 秒（接收方可做重放窗口校验）
- `x-aether-signature-256`：`sha256=<hex>`，HMAC-SHA256(secret, rawBody)

### 5. 投递语义与重试

- **at-least-once**：不保证恰好一次；接收方按 `x-aether-delivery` 幂等去重。
- 事务性 outbox：`enqueueWebhookDeliveries(tx, ...)` 与业务变更同事务，
  为每个匹配订阅（realm 匹配 + 未删除 + `events` 含该类型或 `*`）插入一条
  `pending` 投递。业务回滚则事件不入队（不产生幻影事件）。
- Cron 扫描端点 `POST /api/webhooks/dispatch`：
  - 鉴权 `Authorization: Bearer <AETHER_WEBHOOK_DISPATCH_TOKEN>`；未配置
    环境变量时 503（fail-closed，对齐 GitHub webhook route）。Vercel Cron
    自动向该路径发送 `Authorization: Bearer $CRON_SECRET`——部署时将
    `CRON_SECRET` 设为同值即可。
  - 每次领取至多 25 条 `pending AND next_attempt_at <= now`，逐条投递：
    - 2xx → `succeeded` + `delivered_at`
    - 非 2xx / 网络错误 / 超时（10s）→ `attempts+1`；`attempts` 达 8 次上限
      → `exhausted`，否则回 `pending` 且 `next_attempt_at = now + backoff`
    - 订阅已删除 → `canceled`
    - 密钥解密失败（env key 轮换）→ `exhausted` + last_error 说明
  - 退避：30s × 2^(n-1)，上限 1h（30s / 1m / 2m / 4m / 8m / 16m / 32m / 64m，
    总窗口约 2h）。
- 幂等更新守卫：finalize 带 `WHERE status='pending' AND attempts=<n>`，
  并发扫描不重复计数。

### 6. 纯函数层（`@aether/resonance` `src/webhooks.ts`）

事件目录与类型守卫、`generateWebhookSecret`、`signWebhookPayload`（Web Crypto）、
`computeWebhookBackoffMs`、`buildWebhookHeaders`、常量
（`MAX_WEBHOOK_ATTEMPTS=8`、退避基数 / 上限）。运行时无关（Web Crypto），
web 与 converge-server 均可复用。

## 不在本 spec 范围

- 订阅管理的 Web UI（设置页面板，后续迭代）
- 事件回放 / 手动重投 API
- 死信队列导出
- OAuth App Registry（独立任务）

## 验收标准

- API Key 可完成 创建订阅 → 触发事件（创建 Thread / 迁移状态 / 追加对话）→
  收到带正确签名的回调 → 查询投递历史 的全链路。
- 签名可被第三方用 secret 独立验证（HMAC-SHA256 over raw body）。
- 失败投递按指数退避重试至多 8 次后落 `exhausted`。
- 密钥明文不落库、不落日志；创建响应仅返回一次。
- 跨 Realm 访问 404；未配置 dispatch token 时端点 503。
- typecheck / lint / test / build 全绿。
