# 技术选型决策表

本文件固化关键技术选型，每项包含推荐、备选、理由、风险与弃用信号。选型以与 Aether 术语体系、Vercel 部署形态、Yjs CRDT 架构的兼容性为最高准则。

## 决策表

| 领域 | 推荐选型 | 备选 | 理由与兼容性 | 风险与降级 |
|---|---|---|---|---|
| Monorepo 编排 | pnpm + Turborepo（Latest） | Bun workspaces | pnpm 严格依赖解析；Turborepo remote cache 与 Vercel 原生集成 | 依赖图复杂 → 用 `dependsOn` 显式声明任务管线 |
| 客户端状态管理 | Zustand | Jotai | 单一 store 便于与 Yjs 双向绑定，模式成熟；与 RSC 边界清晰 | store 膨胀 → 按 Current 命名空间拆分 domain store |
| 服务端状态 | Next 16 Server Actions + React Cache；TanStack Query（客户端缓存） | tRPC | Server Actions 原生适配 PPR 与 Edge；TanStack 负责乐观更新 | Server Actions 与 Yjs 汇合需统一序列化 → 在 `@aether/current-sync` 定义单一适配层 |
| 表单 | React Hook Form + Zod | TanStack Form | RHF 非受控性能好；Zod 与 Drizzle 类型共享 | 深层嵌套表单 → 拆分子表单组件 |
| 单元测试 | Vitest + Testing Library | Jest | 与 Vite 8 同构生态，TS7 原生支持 | 编辑器渲染断言不稳 → 断言粒度下沉到纯 CRDT 层 |
| 端到端测试 | Playwright | Cypress | 覆盖编辑器、协同、多客户端并发场景 | 多浏览器成本高 → 收敛为关键路径冒烟集 |
| 静态检查/格式化 | Biome | ESLint 9 flat + Prettier | 单二进制、速度快、原生支持 TS7 | 插件生态弱 → 关键规则保留 ESLint 二跑 |
| 样式 | Tailwind CSS 4（@tailwindcss/vite） | CSS Modules / Panda CSS | v4 Rust 引擎编译快，设计令牌承载术语体系 | v4 插件语法仍在演进 → 锁定版本并纳入 cache key |
| 实时协同 | Yjs + Hocuspocus（收敛服务） | y-websocket + 自建 Edge 适配 | Hocuspocus 提供鉴权、持久化、多文档原生支持 | 收敛服务不适合 Edge 长连接 → Node runtime 独立服务，Edge 只做网关 |
| 数据持久化 | PostgreSQL + Drizzle ORM + Drizzle Kit | Prisma | Drizzle 轻量、SQL 原生、serverless 友好，schema 即类型 | 迁移纪律要求高 → 固化迁移流程（见 [team-norms.md](./team-norms.md)） |
| 认证与身份 | Better-Auth | Auth.js | 组织模型原生支持 Realm > Project > Member 三级嵌套，内建 SSO/SCIM | 生态较新 → 锁定文档版本，`@aether/auth` 适配层隔离升级冲击 |
| 组件原语 | Radix UI + shadcn/ui 模式 | MUI | 无样式原语与 Tailwind v4 令牌无缝拼接 | — |
| 部署 | Vercel（web / editor-host）+ Cloudflare Workers Durable Objects（converge-server） | — | Vercel 与 Turborepo remote cache、分支 Manifestation 深度集成；CF Workers 提供原生 WebSocket、零冷启动、零成本 | converge-server 厂商锁定 → 保留 Node 自托管入口（src/index.ts）作为回退 |

## 各选型引入时机

| 选型 | 引入时机 | 前置条件 |
|---|---|---|
| Turborepo + pnpm | M0 立即 | 无 |
| Tailwind v4 | M0 立即 | 完成 `@aether/config` 基础配置 |
| Drizzle + Drizzle Kit | M0 立即 | 完成核心 schema 草案（见 [data-model.md](./data-model.md)） |
| Better-Auth | M0 立即 | Realm Tree 三级模型需求冻结 |
| Yjs + Hocuspocus | M1 | 完成 M0 技术探测（Edge/Serverless 持久化验证） |
| Zustand | M1 | Current 数据平面确定后引入，避免过早封装 |
| TanStack Query | M1 | 客户端缓存需求出现后引入 |
| Resonance Gateway | M3 | 内部功能完成 API 化改造 |
| Marketplace / Self-host | M3 末段 | Resonance Gateway 稳定后开放 |

## 弃用信号与回退条件

| 选型 | 弃用信号 | 回退动作 |
|---|---|---|
| Zustand | store 跨域耦合失控，diff 维护成本超过 Jotai 原子化收益 | 迁移至 Jotai，保留 `@aether/state` 对外接口不变 |
| Hocuspocus | Vercel Fluid Compute 不可用或成本失控 | 收敛服务独立部署，WebSocket 走独立域名（见 [risks.md](./risks.md) 风险 1） |
| Drizzle | 复杂查询嵌套场景超出预期，迁移负担过重 | 保留 Drizzle 作为查询层，读写路径解耦 |
| Better-Auth | 三级组织模型需深度定制 | 在 `@aether/auth` 适配层内扩展，禁止下游包直接依赖 |
| Tailwind v4 | Rust 引擎与工具链出现不可控冲突 | 锁定已通过验证的版本，暂缓跟随 minor 升级 |
