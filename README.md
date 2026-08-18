# Aether

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
│   └── @aether/resonance/        # 公开 API Gateway（M3 占位）
└── docs/                         # 架构规划、里程碑、技术决策、规范文档
```

Web 认证入口位于 `apps/@aether/web/lib/auth.ts`，Better-Auth 路由位于
`apps/@aether/web/app/api/auth/[...all]/route.ts`；认证主体解析统一经
`@aether/auth` 完成。

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

## 开发规范

- 全部代码使用 TypeScript Strict Mode，禁止 `any`（必要时用 `unknown` + 类型守卫）。
- 包导出遵循 monorepo-structure，禁止跨包直接引用内部实现。
- 文档变更随对应代码 PR 一并评审。
- 提交信息遵循 Conventional Commits。

## License

MIT
