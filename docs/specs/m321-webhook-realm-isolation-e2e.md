# Spec: M3.21 — Webhook 投递跨 Realm 隔离端到端验证

M3.20 验证了 Resonance Gateway 请求时（同步拉取）的跨 Realm 隔离。本里程碑对
Webhook Constellation 的**异步投递链路**（入队 → Cron 扫描 → HTTP 出站）执行
端到端跨 Realm 隔离验证，补齐 M3.20 留出的"依赖 Cron + 真实 HTTP"缺口。

## 定位

- **验证而非新功能**：不引入生产代码变更，仅新增端到端隔离测试套件。
- **覆盖投递链路三层隔离**：
  1. **入队隔离**（`enqueueWebhookDeliveries`）：业务事件按
     `eq(webhookSubscriptions.realm_id, realmId)` 过滤订阅，Realm A 的事件只
     为 A 的订阅产生 pending 投递，B 订阅不收任何 A 事件。
  2. **投递隔离**（`dispatchPendingWebhooks`）：Cron 全局扫描 pending
     deliveries，每条 delivery JOIN 其 subscription 获取 url 与 secret；
     A 的 delivery 只投递到 A 订阅的 url，绝不投递到 B 订阅的 url。
  3. **订阅方查询隔离**（`handleListWebhookDeliveries` /
     `handleDeleteWebhook`）：令牌 A 查询 / 删除 B 的订阅 → 404，不泄露
     存在性。

## 隔离不变量

对任意令牌 T（绑定 Realm R）与任意 Webhook 投递：

| 不变量 | 强制点 | 期望 |
|---|---|---|
| Realm A 业务事件入队 | `eq(subscriptions.realm_id, A)` | 仅 A 订阅产生 delivery |
| Cron 扫描 A 的 delivery | delivery.subscription_id → A 订阅 url | fetch 仅命中 A 订阅 url |
| 令牌 A 查 B 订阅 deliveries | `eq(subscriptions.realm_id, R)` 守卫 | 404 |
| 令牌 A 删 B 订阅 | `subscription.realm_id !== R` 守卫 | 404 |
| delivery.payload.realm.id | 入队时绑定 `realmId` | 与订阅 realm 一致 |

## 验证矩阵

两个 Realm（A、B）各持有订阅（subA@urlA / subB@urlB）、pending delivery。

### 入队隔离（`enqueueWebhookDeliveries`）

- [ ] Realm A 事件入队 → 仅为 subA 插入 delivery；subB 无 delivery
- [ ] Realm B 事件入队 → 仅为 subB 插入 delivery；subA 无 delivery
- [ ] A 事件入队的 delivery.payload.realm.id = A（信封 realm 与订阅一致）

### 投递隔离（`dispatchPendingWebhooks`）

- [ ] 双 Realm 各一条 pending delivery → fetch 仅命中各自订阅 url（urlA、
      urlB 各一次），A delivery 不到 urlB，B delivery 不到 urlA
- [ ] A delivery 的 POST body payload.realm.id = A；B delivery = B
- [ ] 签名头由各自订阅的 secret 生成（互不串用）

### 订阅方查询 / 删除隔离

- [ ] 令牌 A 查 subB 的 deliveries → 404（不泄露存在性）
- [ ] 令牌 A 删 subB → 404

### 同 Realm 正向回归

- [ ] Realm A 事件入队 → dispatch 投递到 urlA 成功（succeeded）
- [ ] 令牌 A 查 subA 的 deliveries → 200

## 实现约束

- **测试范式**：沿 `webhook-service.test.ts` 的 mock 范式（mock `getDb` /
  `authorizeRequest` / `recordAuditEntry` / `createLogger` /
  `getIntegrationEncryptionKey`），保留纯函数 `requireRealmMatch` /
  `apiKeyActor` 实际实现；`fetch` 用 `vi.stubGlobal` 捕获出站调用。
- **mock db 双 Realm 固件**：`select` 链按 where `realm_id` 返回对应 Realm
  的订阅 / delivery；`enqueueWebhookDeliveries` 第一次 select（订阅匹配）
  仅返回同 realm 订阅，验证入队过滤。
- **真实 AES-GCM 往返**：加密密钥用 `randomBytes(32)` 生成，不 mock
  `@aether/resonance`，确保投递签名可交叉验证。
- **不触真实数据库 / 不发真实 HTTP**：纯单测，CI 无 Postgres / 无出站网络。
- **不修改生产代码**：若测试暴露隔离缺口，另起 fix 任务；本里程碑仅验证。

## 不在本次范围

- OAuth 授权流程跨 Realm 的 UI 级验证（同意页已校验 realm member，留手动验收）
- 性能 / 冷启动隔离（属 M3 性能优化任务）
- Webhook 投递在真实 Cron 调度下的时序验证（单测覆盖扫描逻辑即可）

## 验收标准

- [ ] 验证矩阵全部用例通过
- [ ] 入队隔离：A 事件不为 B 订阅产生 delivery
- [ ] 投递隔离：A delivery 仅投递到 A 订阅 url
- [ ] `pnpm typecheck` / `lint` / `test` / `build` 全绿；文档同步
