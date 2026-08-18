# Monorepo 目录结构与包职责

包管理采用 pnpm + Turborepo（Latest）。应用包与共享包统一 `@aether` scope，职责命名直接映射品牌术语。

## 目录结构

```text
aether/
├── turbo.json                        # 任务管线：build/lint/test/typecheck，remote cache
├── pnpm-workspace.yaml
├── package.json
├── .github/workflows/ci.yml
├── .vercel/                          # Vercel 项目与分支 Manifestation 配置
│
├── apps/
│   ├── @aether/web/                  # Next.js 16 主应用（App Router / Server Actions / PPR / Edge）
│   ├── @aether/editor-host/          # 编辑器宿主：Current 渲染层、Drift 持久化入口
│   └── @aether/converge-server/      # Hocuspocus 收敛服务：CRDT 增量持久化 + Redis 广播
│
└── packages/
    ├── @aether/db/                   # Drizzle schema + Drizzle Kit 迁移，Realm 隔离封装
    ├── @aether/auth/                 # Better-Auth：Realm Tree、Entity Identity、登录态
    ├── @aether/current-sync/         # Yjs Provider、Presence、Converge Engine、重连握手
    ├── @aether/entity-core/          # Entity 运行时、Capability Manifesto、Handoff Gate 状态机
    ├── @aether/entitlement/          # 角色、作用域与资源三级授权判定
    ├── @aether/thread-bindings/      # Thread↔Code↔Manifestation↔Dialogue 双向绑定内核
    ├── @aether/manifestation/        # Vercel Preview 集成、Inline Annotation、Spot Diff
    ├── @aether/resonance/            # 公开 API Gateway、Webhook、OAuth 注册、SDK 导出
    ├── @aether/ui/                   # Yohaku 设计令牌（tokens.css/tokens.ts + verify），仅 tokens 契约
    ├── @aether/state/                # Zustand 客户端状态层，Yjs 双向绑定适配
    ├── @aether/types/                # 共享类型、Yjs schema 类型生成与校验
    ├── @aether/config/               # TS7 / ESLint / Tailwind 共享配置
    └── @aether/observability/        # 日志、遥测、Converge Telemetry 采集
```

## 包职责与依赖

| 包 | 职责边界 | 直接依赖 | 构建方式 |
|---|---|---|---|
| `@aether/db` | Drizzle schema、迁移、查询封装、Realm 隔离查询守卫 | `@aether/types` | tsc |
| `@aether/auth` | Better-Auth 适配、Realm Tree 三级模型、Entity 身份、权限中间件 | `@aether/db`、`@aether/types` | tsc |
| `@aether/current-sync` | Yjs Provider、Presence、Realm Channel Partition、Converge Engine、Reconnect 握手、序列化适配层 | `@aether/types`、Yjs、y-protocols | tsc |
| `@aether/entity-core` | Entity 运行时、Capability Manifesto、Handoff Gate 状态机、审计埋点 | `@aether/auth`、`@aether/db`、`@aether/types` | tsc |
| `@aether/entitlement` | 角色、作用域与资源三级授权判定，Drizzle Entitlement Subject 加载 | `@aether/auth`、`@aether/db`、`@aether/types` | tsc |
| `@aether/thread-bindings` | Thread 锚点绑定、对话内嵌、重水合路径、绑定内核 | `@aether/db`、`@aether/types` | tsc |
| `@aether/manifestation` | Vercel Preview 集成、Inline Annotation、Spot Diff、画廊 | `@aether/current-sync`、`@aether/types` | tsc |
| `@aether/resonance` | 公开 API 路由定义、Webhook 投递、OAuth 注册、SDK 导出 | `@aether/auth`、`@aether/db`、`@aether/types` | tsc + Vite 8 库模式 |
| `@aether/ui` | 设计令牌契约（tokens.css/tokens.ts + verify），仅 tokens，无运行时产物 | 无 | 纯配置（check 校验） |
| `@aether/state` | Zustand store、Yjs 双向绑定、乐观更新 | `@aether/current-sync`、`@aether/types` | tsc |
| `@aether/types` | 共享类型、Yjs schema 类型生成与校验 | 无 | tsc |
| `@aether/config` | TS7 / ESLint / Tailwind 共享配置 | 无（对外运行时零依赖；内部自带 eslint/tailwind 工具依赖） | 纯配置 |
| `@aether/observability` | 日志、遥测、遥测采集 SDK | `@aether/types` | tsc |

### 品牌资产

- Logo 等品牌 SVG 统一放在 `packages/@aether/ui/src/assets/branding/`，经 `@aether/ui/assets/branding/*` 导出供全仓引用。
- `aether-logo.svg`：完整品牌标（图形标 + 字标，品牌色）；`aether-logo-baseline.svg`：单色字标基线版（深炭灰）。
- 新增品牌资产一律入此目录并更新 `@aether/ui` 的 `exports` 映射。

## 架构规则

### 依赖方向单向

- `apps` 依赖 `packages`，包间不反向引用。
- `@aether/db` 与 `@aether/types` 是最底层，上层包只依赖它们。
- 禁止两个平级包互相依赖；确需共享逻辑时下沉到更底层包。

### 构建边界（Next 16 + Vite 8 切分线）

| 归属 | 内容 | 构建系统 |
|---|---|---|
| Next 16 | SSR/RSC 页面、Server Actions、Edge Functions、PPR 路由 | Turborepo → Next |
| Vite 8 | `@aether/resonance` SDK、`@aether/editor-host` 高频交互模块 | Vite 8 |
| 中间层 | 纯逻辑包（db/auth/types/current-sync 等） | tsc，双端复用 |

边界纪律：SSR/RSC 页面归 Next，高频模块与 UI 库归 Vite；Turborepo 负责构建产物编排；禁止同包内混用两套 dev server。

### Turborepo 管线要点

- `turbo.json` 声明 `build`、`lint`、`test`、`typecheck` 任务，`dependsOn` 显式声明包间依赖。
- remote cache 对接 Vercel Remote Caching，CI 与本地共享缓存。
- Tailwind 版本与 `@aether/config` 版本哈希纳入 cache key，规避 Rust 引擎脏缓存（详见 [risks.md](./risks.md) 风险 3）。
- `@aether/state` 的 tsc 构建产物（dist）与各应用的 `.next`/`dist`/`out` 均列入 `outputs` 白名单。
