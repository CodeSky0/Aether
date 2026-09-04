# Plan: M3.17 — Webhook Constellation（出站事件订阅 / 签名 / 重试）

## 步骤

1. **@aether/resonance · 纯函数层**
   - 新建 `src/webhooks.ts`：事件目录（`WEBHOOK_EVENT_TYPES` / `WebhookEventType` /
     `WEBHOOK_ALL_EVENTS` + 守卫）、`generateWebhookSecret`（`whsec_` + base64url 32B）、
     `signWebhookPayload`（HMAC-SHA256 → `sha256=<hex>`）、
     `computeWebhookBackoffMs`、`buildWebhookHeaders`、重试常量；
     `src/index.ts` 导出。
2. **@aether/db · schema + 迁移**
   - `schema.ts` 追加 `webhookDeliveryStatusEnum`、`webhookSubscriptions`、
     `webhookDeliveries`（列 / 索引见 spec）。
   - `pnpm --filter @aether/db db:generate` 生成 0005 迁移。
3. **Web · 协议层**
   - 新建 `lib/webhooks/protocol.ts`：`createWebhookInputSchema`（name ≤ 100 /
     url https ≤ 2048 / events 非空且目录内或 `*`）、订阅与投递资源映射、
     复用 `lib/resonance/protocol.ts` 的 `apiJson` / `apiError` / 分页。
4. **Web · 服务层**
   - 新建 `lib/webhooks/service.ts`：
     - `handleListWebhooks` / `handleCreateWebhook`（生成 secret → AES-GCM 加密
       入库 → 审计 → 201 + 明文 secret 一次性返回）/
       `handleDeleteWebhook`（软删除 + 审计）/ `handleListWebhookDeliveries`。
     - `enqueueWebhookDeliveries(tx, { realmId, eventType, data })`：
       同事务查匹配订阅并插入 `pending` 投递（`events @> [type] OR @> ["*"]`）。
     - `dispatchPendingWebhooks(now?)`：领取 ≤ 25 条 → 逐条解密 secret → 签名 →
       fetch（10s 超时）→ 幂等 finalize（succeeded / 重试退避 / exhausted / canceled）。
   - `lib/resonance/auth.ts`：抽出 `authorizeRequest` / `requireRealmMatch` /
     `apiKeyActor` 供 webhook 服务复用；`lib/resonance/http.ts` 抽出
     `runHandler` / `readJsonBody` / `isResponse`。
     三个写路径接入 enqueue（thread.created / thread.status_changed——仅状态
     实际变化时 / dialogue.message_created）。
   - `lib/threads.ts`：会话 `createThread` 改为事务（insert + enqueue 原子化）。
5. **Web · 路由（thin routes）**
   - `app/api/v1/realms/[realmId]/webhooks/route.ts`（GET/POST）
   - `app/api/v1/webhooks/[subscriptionId]/route.ts`（DELETE）
   - `app/api/v1/webhooks/[subscriptionId]/deliveries/route.ts`（GET）
   - `app/api/webhooks/dispatch/route.ts`（POST，Bearer
     `AETHER_WEBHOOK_DISPATCH_TOKEN`，未配置 503）
   - `vercel.json` 追加 crons：`/api/webhooks/dispatch` 每分钟。
6. **测试**（`@aether/resonance` 无 vitest 基建，包级测试寄宿 web tests）
   - Web `tests/webhook-core.test.ts`（@aether/resonance 纯函数）：secret 格式、
     sign/verify 往返 + node:crypto 交叉验证、退避序列与上限、headers 形状、
     事件目录守卫、AES-GCM 加解密往返与密钥轮换失败。
   - Web `tests/webhook-protocol.test.ts`：输入 schema（https 限定 / 目录守卫）、
     事件归一化、订阅 / 投递资源映射。
   - Web `tests/webhook-service.test.ts`：鉴权 401 / 跨 Realm 404、
     创建校验（url 非 https / events 越界）、加密密钥未配置 503、
     创建 201 + secret 一次性返回 + 审计、列表 / 删除 / 投递历史、
     enqueue 匹配（信封 / 零订阅零写入）、dispatch 鉴权（恒时比较 / 未配置）、
     dispatch（2xx 成功 / 500 重试退避 / 8 次耗尽 / 订阅删除 canceled /
     解密失败 exhausted / 网络错误 / 签名头可用 secret 验证）。
7. **文档同步**
   - README：公开 API 端点表追加 webhook 端点；环境变量表追加
     `AETHER_WEBHOOK_DISPATCH_TOKEN` / `AETHER_INTEGRATION_ENCRYPTION_KEY`；
     Webhook Constellation 签名验证示例。
   - `docs/README.md` 索引、`docs/roadmap/milestones.md` 勾选 Webhook 任务。
8. **质量检查与交付**
   - `pnpm typecheck` / `pnpm lint` / `pnpm test` / build 全绿。

## 文件变更清单

| 操作 | 路径 |
|------|------|
| 新建 | `packages/@aether/resonance/src/webhooks.ts` |
| 修改 | `packages/@aether/resonance/src/index.ts` |
| 修改 | `packages/@aether/db/src/schema.ts` |
| 新建 | `packages/@aether/db/drizzle/0005_*.sql`（db:generate） |
| 新建 | `apps/@aether/web/lib/webhooks/protocol.ts` |
| 新建 | `apps/@aether/web/lib/webhooks/service.ts` |
| 修改 | `apps/@aether/web/lib/resonance/auth.ts`（公共前置抽取） |
| 新建 | `apps/@aether/web/lib/resonance/http.ts`（公共 HTTP 助手） |
| 修改 | `apps/@aether/web/lib/resonance/service.ts`（发射点接入） |
| 修改 | `apps/@aether/web/lib/threads.ts`（事务化 + 发射点） |
| 新建 | `apps/@aether/web/app/api/v1/realms/[realmId]/webhooks/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/webhooks/[subscriptionId]/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/webhooks/[subscriptionId]/deliveries/route.ts` |
| 新建 | `apps/@aether/web/app/api/webhooks/dispatch/route.ts` |
| 修改 | `apps/@aether/web/vercel.json`（crons） |
| 新建 | `apps/@aether/web/tests/webhook-core.test.ts` |
| 新建 | `apps/@aether/web/tests/webhook-protocol.test.ts` |
| 新建 | `apps/@aether/web/tests/webhook-service.test.ts` |
| 修改 | `apps/@aether/web/tests/resonance-service.test.ts`（auth mock 适配 + 发射点断言） |
| 修改 | `README.md` |
| 修改 | `docs/README.md` |
| 修改 | `docs/roadmap/milestones.md` |
| 新建 | `docs/specs/m317-webhook-constellation.md` |
| 新建 | `docs/specs/m317-plan.md` |

## 风险与注意事项

- `enqueueWebhookDeliveries` 必须与业务变更同事务调用（transactional outbox）；
  业务回滚时事件一并回滚，杜绝幻影事件。
- dispatch 是幂等扫描：finalize 更新必须带 `status='pending'` 守卫；并发 cron
  至多造成 at-least-once 语义内的重复投递（文档已声明，接收方按
  `x-aether-delivery` 去重）。
- secret 只在创建响应出现一次；日志与审计 target 均不得包含明文。
- `encrypted_secret` 依赖 `AETHER_INTEGRATION_ENCRYPTION_KEY`：env key 轮换后
  旧订阅解密失败 → 投递落 `exhausted` 并记录 last_error，不中断批次。
- dispatch 端点鉴权失败不泄露配置状态；token 比较用恒时比较。
- web 服务层不得 import 任何 `'use server'` 模块（M3.16 同一戒律）。
- 事件载荷保持 lean（引用 + 描述符），防 jsonb 膨胀与数据过度暴露。
