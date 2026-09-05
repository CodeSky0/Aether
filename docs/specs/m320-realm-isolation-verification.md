# Spec: M3.20 — Realm Isolation 生产级验证

多租户边界在生产级配置下不可突破：任一令牌（API Key / OAuth token）只能
访问其绑定 Realm 的资源，跨 Realm 一律 404 且不泄露存在性。本里程碑对
M3.16–M3.19 已落地的 Resonance Gateway / Webhook / OAuth / API-First 全链路
执行系统级隔离验证，补齐现有测试的唯一跨 Realm 用例（仅 handleGetRealm）。

## 定位

- **验证而非新功能**：不引入生产代码变更，仅新增隔离测试套件。
- **覆盖现有隔离机制的三层守卫**：
  1. 鉴权层 `resolveApiKey`：令牌绑定单一 `realm.id`（API Key 的
     `apiKeys.realm_id` / OAuth 的 `oauthAuthorizations.realm_id`）。
  2. 路径守卫 `requireRealmMatch`：`/realms/:realmId/*` 路径 realmId ≠ 令牌
     realm → 404。
  3. 资源守卫 `requireThreadRow` + core 层 `eq(threads.realm_id, realmId)`：
     `/threads/:threadId` 跨 Realm → 404；列表查询强制 realm_id 过滤。

## 隔离不变量

对任意令牌 T（绑定 Realm R）与任意请求：

| 不变量 | 强制点 | 期望 |
|---|---|---|
| 路径 realmId ≠ R | `requireRealmMatch` | 404（不泄露存在性） |
| Thread 属于 R' ≠ R | `requireThreadRow(db, R, tid)` 返回 null | 404 |
| 列表查询 | `eq(<table>.realm_id, R)` | 仅返回 R 的行 |
| 创建 Thread project_id 属于 R' | core `project.realm_id = R` 校验 | 400 invalid_project |
| PATCH / dialogue 跨 Realm | `requireThreadRow` 守卫 | 404 |
| Webhook 订阅管理 | 订阅绑定 `realm_id`；列表只返 R | 跨 Realm 404 |
| OAuth App 管理 | App 绑定 `realm_id`；管理需 realm owner/admin | 跨 Realm 403/404 |
| audit_log 查询 | `eq(audit_log.realm_id, R)` | 不泄露他 Realm 审计 |

## 验证矩阵

两个 Realm（A、B）各持有令牌、Thread、Project、Webhook 订阅、OAuth App。
令牌 A 发起下列请求，期望全部被隔离边界拦截：

### 路径守卫（/realms/:realmId/*）

- [ ] `GET /api/v1/realms/B` → 404
- [ ] `GET /api/v1/realms/B/projects` → 404
- [ ] `GET /api/v1/realms/B/threads` → 404
- [ ] `POST /api/v1/realms/B/threads`（project_id 属 B）→ 404（路径守卫先于 body）
- [ ] `GET /api/v1/realms/B/entities` → 404
- [ ] `GET /api/v1/realms/B/currents` → 404
- [ ] `GET /api/v1/realms/B/webhooks` → 404

### 资源守卫（/threads/:threadId，Thread 属 B）

- [ ] `GET /api/v1/threads/<B-thread>` → 404
- [ ] `PATCH /api/v1/threads/<B-thread>` → 404
- [ ] `GET /api/v1/threads/<B-thread>/dialogues` → 404
- [ ] `POST /api/v1/threads/<B-thread>/dialogues` → 404

### 列表隔离（令牌 A 列表不含 B 数据）

- [ ] `GET /api/v1/realms/A/threads` → 仅 A 的 Thread（mock db 含 B 的行，
      查询 where `realm_id = A` 不返回 B 行）
- [ ] `GET /api/v1/realms/A/projects` → 仅 A 的 Project

### 写隔离

- [ ] `POST /api/v1/realms/A/threads`（project_id 属 B）→ 400 invalid_project
      （core 层 project 归属校验：`projects.realm_id = A` 不命中 B 的 project）

### 同 Realm 正向回归

- [ ] `GET /api/v1/realms/A` → 200
- [ ] `GET /api/v1/threads/<A-thread>` → 200
- [ ] `PATCH /api/v1/threads/<A-thread>` → 200（状态机合法迁移）

## 实现约束

- **测试范式**：沿 `resonance-service.test.ts` 的 mock 范式（mock `getDb` /
  `authorizeRequest` / `enqueueWebhookDeliveries` / `recordAuditEntry` /
  `createLogger`），保留纯函数 `requireRealmMatch` / `apiKeyActor` 实际实现。
- **mock db 双 Realm 数据**：`select` 链按 where 条件返回对应 Realm 的行；
  `requireThreadRow` 按 (realmId, threadId) 命中。验证查询是否带 `realm_id`
  过滤由 mock 拦截 where 实现（返回的行集合即过滤后结果）。
- **不触真实数据库**：纯单测，CI 无 Postgres 依赖。
- **不修改生产代码**：若测试暴露隔离缺口，另起 fix 任务；本里程碑仅验证。

## 不在本次范围

- Webhook 投递跨 Realm 隔离的端到端验证（依赖 Cron + 真实 HTTP，留 M3.21）
- OAuth 授权流程跨 Realm 的 UI 级验证（同意页已校验 realm member，留手动验收）
- 性能 / 冷启动隔离（属 M3 性能优化任务）

## 验收标准

- [ ] 验证矩阵全部用例通过：令牌 A 访问 Realm B 任意资源 → 404 / 400
- [ ] 列表隔离：令牌 A 列表不含 B 的行（mock db 含双 Realm 数据）
- [ ] 同 Realm 正向回归：A 令牌正常读写 A 资源
- [ ] `pnpm typecheck` / `lint` / `test` / `build` 全绿；文档同步
