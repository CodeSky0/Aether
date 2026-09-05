# Aether

[![wakatime](https://wakatime.com/badge/user/83cfde66-b869-4166-b788-7987958b60e1/project/33da1083-5ed4-4349-bae1-7e30bcbf1772.svg)](https://wakatime.com/badge/user/83cfde66-b869-4166-b788-7987958b60e1/project/33da1083-5ed4-4349-bae1-7e30bcbf1772)

> 协同智能的介质：承载人、Entity、代码与上下文共存的原生环境。

Aether 是一个多租户协同智能平台，将 AI Entity 提升为与人类对等的一等公民，通过 CRDT 实现实时协同编辑，通过审计日志保证全链路可追溯。

## 技术栈

- **Monorepo**: Turborepo + pnpm（Node >= 22）
- **前端**: Next.js 16（App Router / Server Actions）+ Vite 8（编辑器宿主）
- **协同引擎**: Yjs + Hocuspocus（权威 WebSocket 通道）+ Server Actions（降级轮询通道）
- **数据层**: Drizzle ORM + PostgreSQL（bytea / jsonb / bigserial）
- **认证**: Better-Auth（Organization 三级模型：Realm > Project > Member）
- **样式**: Tailwind CSS v4 + Yohaku 设计系统
- **语言**: TypeScript 7 Strict Mode
- **测试**: Vitest

## 快速开始

```bash
# 安装依赖
pnpm install

# 全量构建
pnpm build

# 开发模式（并行启动所有应用）
pnpm dev

# 质量检查
pnpm typecheck
pnpm lint
pnpm test
```

### 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `DATABASE_URL` | Postgres 连接 URL | 是（web / converge-server） |
| `REDIS_URL` | Redis 连接 URL（多实例广播） | 否 |
| `PORT` | converge-server 监听端口（默认 1234） | 否 |
| `AETHER_AUTH_GUARD_ENABLED` | 鉴权守卫开关（默认 true） | 否 |
| `AETHER_ENTITLEMENT_ENABLED` | Entitlement Engine 强制判定开关（默认 false） | 否 |
| `BETTER_AUTH_URL` | Better-Auth 应用基础 URL | 否（未配置时不解析会话主体，Current 写入退化为 `web-client`） |
| `BETTER_AUTH_SECRET` | Better-Auth 会话签名密钥 | 否（未配置时不解析会话主体，Current 写入退化为 `web-client`） |
| `AETHER_MAIL_PROVIDER` | 邀请邮件 provider：`console`（默认）或 `resend` | 否 |
| `RESEND_API_KEY` | Resend API 密钥（`AETHER_MAIL_PROVIDER=resend` 时必填） | 否 |
| `AETHER_MAIL_FROM` | Resend 发件人（`AETHER_MAIL_PROVIDER=resend` 时必填） | 否 |
| `AETHER_DATABASE_URL` | Realm organization 回填 CLI 使用的 Postgres 连接 URL | 脚本 apply / dry-run 时必填 |
| `AETHER_OIDC_DISCOVERY_URL` | 外部 IdP 的 OIDC discovery 文档 URL（与 `AETHER_OIDC_CLIENT_ID` 成对配置） | 否 |
| `AETHER_OIDC_CLIENT_ID` | OIDC client id（与 `AETHER_OIDC_DISCOVERY_URL` 成对配置） | 否 |
| `AETHER_OIDC_CLIENT_SECRET` | OIDC client secret（PKCE public client 可省） | 否 |
| `AETHER_OIDC_NAME` | SSO 登录按钮显示名（默认 `SSO`） | 否 |
| `AETHER_OIDC_PROVIDER_ID` | OIDC provider 标识（默认 `oidc`） | 否 |
| `AETHER_OIDC_SCOPES` | 空格分隔的 OAuth scopes（默认 `openid email profile`） | 否 |
| `AETHER_OIDC_PKCE` | 设为 `true` 时启用 PKCE | 否 |
| `AETHER_OIDC_ISSUER` | 显式 issuer 校验（RFC 9207） | 否 |
| `AETHER_SCIM_TOKEN` | SCIM 2.0 provisioning Bearer token（与 `AETHER_SCIM_REALM_ID` 成对配置，长度 ≥ 16） | 否 |
| `AETHER_SCIM_REALM_ID` | SCIM 管辖的 Realm id（与 `AETHER_SCIM_TOKEN` 成对配置；Realm 须已绑定真实 organization） | 否 |
| `AETHER_INTEGRATION_ENCRYPTION_KEY` | 集成凭据加密密钥（base64 编码 32 字节；GitHub installation token 与 webhook secret 加密入库） | 使用 GitHub App 集成或 Webhook 时必填 |
| `AETHER_WEBHOOK_DISPATCH_TOKEN` | Webhook 投递扫描端点 Bearer token（Vercel Cron 鉴权；未配置端点 503 fail-closed） | 使用 Webhook 时必填 |

## 项目结构

```
Aether/
├── apps/
│   ├── @aether/web/              # Next.js Web 应用（Realm/Thread/Audit/Current 编辑器）
│   ├── @aether/editor-host/      # Vite 编辑器宿主（Yjs Provider + Drift 持久化）
│   └── @aether/converge-server/  # Hocuspocus 收敛服务（Postgres 持久化 + Redis 广播）
├── packages/
│   ├── @aether/types/            # 共享类型与术语唯一事实源
│   ├── @aether/db/               # Drizzle schema + Realm 隔离守卫 + CRDT 增量存储
│   ├── @aether/auth/             # Better-Auth 封装（Realm Tree 权限模型）
│   ├── @aether/current-sync/     # Yjs 适配层（序列化/反序列化/更新订阅）
│   ├── @aether/state/            # Zustand store 与 Yjs 双向绑定
│   ├── @aether/entity-core/      # Entity 身份、能力宣言、审计轨迹、Handoff 状态机
│   ├── @aether/entitlement/      # 角色、作用域与资源三级授权判定
│   ├── @aether/thread-bindings/  # Thread 代码锚点绑定、对话锻造、上下文重建
│   ├── @aether/manifestation/    # Manifestation URL 绑定与版本追踪
│   ├── @aether/ui/               # 共享 UI 组件与设计 tokens
│   ├── @aether/config/           # TS / ESLint / Tailwind 共享配置
│   ├── @aether/observability/    # 可观测性层（M3 占位）
│   └── @aether/resonance/        # 公开扩展层（凭据加密 / GitHub App OAuth / Webhook）
└── docs/                         # 架构规划、里程碑、技术决策、规范文档
```

web 与 editor-host 部署到 Vercel（各为一个 Vercel 项目，Root Directory
分别指向对应 app 目录）；converge-server 部署到 Cloudflare Workers
（Durable Objects，零成本免费计划）。完整步骤与环境变量清单见
[docs/deployment.md](docs/deployment.md)。

Web 认证入口位于 `apps/@aether/web/lib/auth.ts`，Better-Auth 路由位于
`apps/@aether/web/app/api/auth/[...all]/route.ts`；认证主体解析统一经
`@aether/auth` 完成。登录 / 注册 / 登出位于 `/login` 与 Header 用户区。

外部 IdP（OIDC）登录：配置 `AETHER_OIDC_DISCOVERY_URL` 与
`AETHER_OIDC_CLIENT_ID`（两者必须成对）后，登录页出现 SSO 按钮；IdP 侧
回调地址需登记为 `${BETTER_AUTH_URL}/api/auth/oauth2/callback/<providerId>`。

SCIM 2.0 provisioning：配置 `AETHER_SCIM_TOKEN` 与 `AETHER_SCIM_REALM_ID`
（两者必须成对）后，IdP（Azure AD / Okta 等）可对接
`${BETTER_AUTH_URL}/api/scim/v2/*` 端点（Users 列表 / 创建 / 查询 / PATCH
启用禁用 / DELETE 回收），鉴权方式为 Bearer token。SCIM 建立的成员以
`member` 角色镜像进 Aether membership，全部操作落审计。

## 公开 API（Resonance Gateway）

第三方应用（CLI / CI / IDE 插件 / Entity 运行时）通过 `/api/v1` 公开 REST
API 访问 Aether。鉴权双通道：API Key（Realm 设置页 General tab → API Keys，
owner / admin 生成，格式 `aeth_<base64url>`，明文仅生成时展示一次）或
OAuth access token（见 [OAuth App Registry](#oauth-app-registry)，格式
`aoat_<base64url>`）。

```bash
curl -H "Authorization: Bearer aeth_xxx" \
  "https://<host>/api/v1/realms/<realmId>/threads?status=open&limit=30"
```

| 方法 / 路径 | 说明 |
|---|---|
| `GET /api/v1` | 端点自描述 |
| `GET /api/v1/realms` | 密钥绑定 Realm |
| `GET /api/v1/realms/{realmId}` | Realm 详情 |
| `GET /api/v1/realms/{realmId}/projects` | 项目列表 |
| `GET /api/v1/realms/{realmId}/threads` | Thread 列表（`status` 过滤 + `limit`/`offset` 分页） |
| `POST /api/v1/realms/{realmId}/threads` | 创建 Thread（`project_id` / `title` / `manifestation_url` / `code_anchor`） |
| `GET /api/v1/threads/{threadId}` | Thread 详情（含 `code_anchor`） |
| `PATCH /api/v1/threads/{threadId}` | 状态迁移（`open` → `in_review` → `resolved` → `archived`，支持 reopen）与 `manifestation_url` 绑定 / 解绑 |
| `GET /api/v1/threads/{threadId}/dialogues` | 对话历史（`after=<seq>` 游标） |
| `POST /api/v1/threads/{threadId}/dialogues` | 追加对话消息（`role`: `user`/`assistant`） |
| `GET /api/v1/realms/{realmId}/entities` | Entity 列表 |
| `GET /api/v1/realms/{realmId}/currents` | Current 列表（presence 快照 / 连接状态） |
| `GET /api/v1/realms/{realmId}/webhooks` | Webhook 订阅列表 |
| `POST /api/v1/realms/{realmId}/webhooks` | 创建订阅（`name` / `url` 仅 https / `events`，明文 secret 仅返回一次） |
| `DELETE /api/v1/webhooks/{subscriptionId}` | 删除订阅（软删除，跨 Realm 一律 404） |
| `GET /api/v1/webhooks/{subscriptionId}/deliveries` | 投递记录（`limit`/`offset` 分页） |

约定：错误体 `{ error: { code, message } }`；时间戳 ISO 8601；鉴权失败 401；
跨 Realm 访问一律 404。密钥为 member 级权限（读全部资源 + 写 Thread /
Dialogue）；密钥随创建者失去 Realm active membership 而失效（fail-closed）。
全部写操作以 `api-key:<keyId>` 服务主体身份落审计。规范详见
[docs/specs/m316-resonance-gateway.md](docs/specs/m316-resonance-gateway.md)。

### API-First 架构（内部通道消费同一业务核心）

Thread / Dialogue 的业务规则（project 归属校验、Thread 状态机、dialogue_ref
竞争回写）、同事务审计与 Webhook 事件入队，在
`lib/resonance/core.ts` 唯一实现（与主体无关、与传输无关）。三个通道全部
消费该核心：

| 通道 | 鉴权 | 审计归因 |
|---|---|---|
| 公开 API（`/api/v1`） | API Key fail-closed 三重校验 | `entity` / `api-key:<keyId>` |
| 会话 Server Actions | 会话守卫 + Entitlement | `human` / 当前用户（无会话回退 `web-client`） |
| GitHub 集成（Resonance Bridge） | Webhook HMAC 验签 | `entity` / `github:<installationId>` |

GitHub 侧事件同样遵守 Thread 状态机（人工归档的 Thread 不会被 GitHub 状态
强制迁移）并触发 Webhook 事件。规范详见
[docs/specs/m318-internal-api-first.md](docs/specs/m318-internal-api-first.md)。

### Webhook Constellation（出站事件）

创建订阅后，Aether 将 Realm 内事件以 POST 推送到订阅 URL（at-least-once
语义，接收方按 `x-aether-delivery` 头幂等去重）。事件目录 v1：
`thread.created` / `thread.status_changed` / `dialogue.message_created`，
支持 `"*"` 通配。签名协议镜像 GitHub `X-Hub-Signature-256`：

```bash
# 接收方验签示例（Node）
const expected = 'sha256=' + crypto.createHmac('sha256', secret)
  .update(rawBody).digest('hex')
// 与请求头 x-aether-signature-256 恒时比较
```

投递失败按指数退避重试（30s 起翻倍、封顶 1h，8 次后 exhausted）；投递扫描
由 Vercel Cron 每分钟触发 `/api/webhooks/dispatch`（Bearer
`AETHER_WEBHOOK_DISPATCH_TOKEN` 鉴权，未配置即 503 fail-closed）。规范详见
[docs/specs/m317-webhook-constellation.md](docs/specs/m317-webhook-constellation.md)。

### OAuth App Registry（第三方应用授权）

第三方应用可注册为 OAuth 客户端，经标准授权码流程（+ PKCE S256）代表用户
访问 `/api/v1`。owner / admin 在 Realm 设置页（Integrations tab → OAuth
Apps）注册应用（`client_id` = `oapp_…`，`client_secret` 明文仅注册 / 轮换时
展示一次）并登记 https 回调 URI（loopback http 例外，精确匹配）。

```
GET  /oauth/authorize   授权入口（同意页；校验失败渲染错误页，不重定向）
POST /api/oauth/token   code 兑换（机密客户端；grant_type=authorization_code）
```

```bash
# 1. 引导用户访问同意页
https://<host>/oauth/authorize?client_id=oapp_xxx&redirect_uri=https://ci.example.com/callback&response_type=code&scope=read+write&state=xyz&realm_id=<uuid>&code_challenge=<S256>&code_challenge_method=S256
# 2. 用户批准后回调 ?code=…&state=xyz，应用以 code 换 token
curl -X POST https://<host>/api/oauth/token -H 'content-type: application/json' \
  -d '{"grant_type":"authorization_code","client_id":"oapp_xxx","client_secret":"osec_xxx","code":"oac_xxx","redirect_uri":"https://ci.example.com/callback","code_verifier":"<verifier>"}'
# 3. 携带 aoat_ 令牌访问 /api/v1
curl -H "Authorization: Bearer aoat_xxx" https://<host>/api/v1/realms/<realmId>/threads
```

安全模型：authorization code 一次性、10 分钟过期、sha256 哈希入库；token
同样仅存哈希，同 `(app, user, realm)` 重新授权自动轮换吊销旧 token；scope
（`read` / `write`，缺省 `read`）按 HTTP method 强制，写操作缺 `write` 即
403 `insufficient_scope`；token 随授权用户失去 Realm active membership、
App 软删除或用户吊销而 fail-closed 失效。成员可在 Integrations 页自助吊销
自己的授权。规范详见
[docs/specs/m319-oauth-app-registry.md](docs/specs/m319-oauth-app-registry.md)。

Realm membership 邀请与 JIT 镜像位于 `apps/@aether/web/app/actions/membership.ts`，
Better-Auth organization 操作统一经 `@aether/auth` 封装。

邀请邮件默认输出到 console；生产邮件可设置 `AETHER_MAIL_PROVIDER=resend`、
`RESEND_API_KEY` 和 `AETHER_MAIL_FROM`。既有占位 Realm 可在本地或 CI 中运行
一次性回填脚本（不会被 Web 构建引用）：

```bash
pnpm --filter @aether/auth backfill:realm-orgs -- --owner-email owner@example.com
pnpm --filter @aether/auth backfill:realm-orgs -- --apply --owner-email owner@example.com
```

脚本还支持重复传入 `--realm <slug>=<email>` 覆盖单个 Realm；默认只 dry-run，
需要 `AETHER_DATABASE_URL`、`BETTER_AUTH_URL` 和 `BETTER_AUTH_SECRET`。

## 核心概念

| 术语 | 说明 |
|---|---|
| **Realm** | 租户隔离边界，对应 Better-Auth Organization |
| **Current** | Yjs 协同状态总线，支持多客户端实时编辑 |
| **Entity** | AI 一等公民，拥有独立身份、光标、审计轨迹 |
| **Thread** | 绑定代码锚点 / Manifestation / 对话历史的叙事单元 |
| **Converge** | CRDT 无冲突合并，强调自然汇聚 |
| **Drift** | IndexedDB 本地持久化 + 重连增量对账 |
| **Manifestation** | 可协同标注的 AI 产物（代码片段、文档、图表等） |
| **Audit Vault** | 人类与 Entity 行为的统一审计日志（append-only + sha256） |

## 里程碑

- **M0** 基础设施与脚手架 — 已完成
- **M1** Core Current 引擎 MVP — 已完成（IndexedDB Drift 持久化 + Reconnect Handshake）
- **M2** Entity 与 Context-Bound Threads — 已完成
- **M3** 企业级特性与公测 — 进行中（Web UI / Audit Vault / Manifestation Binding 已落地）

详见 [docs/roadmap/milestones.md](docs/roadmap/milestones.md)。

## 文档

完整文档位于 [docs/](docs/) 目录，推荐阅读顺序：

1. [术语体系](docs/README.md#术语快表)
2. [Yohaku 设计约束](docs/design/yohaku.md)
3. [Monorepo 结构](docs/roadmap/monorepo-structure.md)
4. [技术决策](docs/roadmap/tech-decisions.md)
5. [数据模型](docs/roadmap/data-model.md)
6. [里程碑](docs/roadmap/milestones.md)
7. [风险与降级](docs/roadmap/risks.md)
8. [部署指南](docs/deployment.md)

## 开发规范

- 全部代码使用 TypeScript Strict Mode，禁止 `any`（必要时用 `unknown` + 类型守卫）。
- 包导出遵循 monorepo-structure，禁止跨包直接引用内部实现。
- 文档变更随对应代码 PR 一并评审。
- 提交信息遵循 Conventional Commits。

## License

MIT
