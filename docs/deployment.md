# Aether 部署指南

Aether monorepo 包含三个独立应用，分别部署到 **Vercel**（web / editor-host）与
**Cloudflare Workers**（converge-server，Durable Objects）。三者各自拥有独立的
配置文件、域名和部署流水线。

## 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        生产部署架构                                │
├──────────────────────┬──────────────────────┬───────────────────┤
│     aether-web       │   aether-editor      │  aether-converge  │
│     (Next.js 16)     │   (Vite 8 SPA)       │  (CF Workers DO)  │
│     → Vercel         │     → Vercel         │     → Cloudflare  │
│     Root: apps/      │     Root: apps/      │     Entry: cf/    │
│     @aether/web      │     @aether/         │     index.ts      │
│                      │     editor-host      │                   │
├──────────────────────┼──────────────────────┼───────────────────┤
│  域名:                │  域名:               │  域名:             │
│  aether.example.com  │  editor.example.com │  sync.example.com │
│  (或 *.vercel.app)   │  (或 *.vercel.app)   │  (或 *.workers.dev)│
└──────────┬───────────┴──────────┬───────────┴────────┬──────────┘
           │  iframe 嵌入         │  WebSocket 连接      │
           │  (NEXT_PUBLIC_       │  (NEXT_PUBLIC_      │
           │   EDITOR_HOST_URL)   │   CONVERGE_         │
           │                      │   SERVER_URL)       │
           └──────────────────────┼─────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │   PostgreSQL (Neon)        │ ← 仅 web 需要
                    │   (用户/Realm/Thread/审计)  │
                    └───────────────────────────┘
                    ┌─────────────────────────────┐
                    │   Durable Object Storage     │ ← converge 独立持久化
                    │   (SQLite 后端, Yjs 文档状态) │
                    └─────────────────────────────┘
```

| 项目 | 包路径 | 部署目标 | 框架 | 说明 |
|------|--------|----------|------|------|
| **aether-web** | `apps/@aether/web` | Vercel | Next.js 16 | 主站点：登录、Dashboard、Realm 管理、Current 工作台（iframe 嵌入 Editor） |
| **aether-editor** | `apps/@aether/editor-host` | Vercel | Vite 8 + React | 协同编辑器 SPA（Yjs），接收 URL 参数获取上下文 |
| **aether-converge** | `apps/@aether/converge-server` | Cloudflare Workers | Durable Objects | WebSocket 协同收敛服务，Yjs 文档权威通道 |

### 为什么 converge-server 部署到 Cloudflare Workers？

| 维度 | Vercel Function（旧方案） | Cloudflare Workers DO（现行） |
|------|--------------------------|-------------------------------|
| WebSocket 时长 | Hobby 300s / Pro 最大 800s，到期断连 | **无限制**，连接随客户端生命周期存活 |
| 冷启动 | 函数实例冷启动有延迟 | **零冷启动**，Durable Object 常驻 |
| 成本 | Vercel Pro 计划（Function 长连接耗额度） | **免费计划**（无需信用卡，DO 免费额度充足） |
| 持久化 | 依赖 Postgres `crdt_updates` 表 | **DO Storage**（SQLite 后端，独立持久化，不依赖外部 DB） |
| 多实例广播 | 需配置 Upstash Redis | **无需**，DO 单实例天然串行化 |
| 原生 WebSocket | 需 `ws` 库 + Node runtime 适配 | **原生 WebSocketPair API** |

> **取舍**：CF Workers 的 Yjs 文档状态独立持久化在 DO Storage 中，不回写
> Postgres。web 项目的业务数据（用户 / Realm / Thread / 审计）仍在 Postgres。
> 两套持久化各司其职：DO Storage 存 Yjs CRDT 状态，Postgres 存结构化业务数据。

---

## 前置准备

### 1. 基础设施

| 资源 | 用途 | 推荐 | 谁需要 |
|------|------|------|--------|
| **PostgreSQL** | 用户 / Realm / Thread / 审计等业务数据 | [Neon](https://neon.tech) 或 [Supabase](https://supabase.com) | aether-web |
| **Cloudflare 账号** | 部署 converge-server Workers | [Cloudflare Dashboard](https://dash.cloudflare.com)（免费计划即可） | aether-converge |
| **Vercel 账号** | 部署 web + editor-host | [Vercel](https://vercel.com) | aether-web, aether-editor |

> converge-server 部署到 CF Workers 后**不需要** Postgres 连接，也**不需要**
> Redis。Yjs 文档状态持久化在 Durable Object Storage 中。

### 2. 生成密钥

```bash
# Better-Auth 会话签名密钥（web 项目必填）
openssl rand -base64 32

# Resonance 凭据加密密钥（使用 GitHub App 集成 / Webhook 时必填）
# base64 编码的 32 字节
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. 仓库

确保仓库已推送到 GitHub，且 `pnpm-lock.yaml` 已提交。三个 Vercel/CF 项目
均从同一仓库部署，通过 Root Directory 或 `wrangler.toml` 的 `main` 字段
定位到对应 app。

### 4. Cloudflare Wrangler CLI（本地部署 converge-server 用）

```bash
# 安装 wrangler（已在 converge-server 的 devDependencies 中）
pnpm --filter @aether/converge-server install

# 登录 Cloudflare
pnpm --filter @aether/converge-server exec wrangler login
```

> 也可在 Cloudflare Dashboard 的 Workers 页面直接连接 GitHub 仓库自动部署，
> 无需本地安装 wrangler。详见 [Step 3](#step-3-部署-aether-converge-cloudflare-workers)。

---

## 部署步骤

### Step 1: 部署 aether-web

1. Vercel 控制台 → **Add New → Project**
2. 导入仓库，**Root Directory** 设为 `apps/@aether/web`
3. Framework Preset 自动识别为 **Next.js**
4. 构建命令和输出目录无需手动设置（已由 `vercel.json` 配置，含自动迁移逻辑）：
   ```json
   {
     "framework": "nextjs",
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "cd ../../.. && node scripts/vercel-build.mjs && pnpm turbo run build --filter=@aether/web",
     "crons": [
       {
         "path": "/api/webhooks/dispatch",
         "schedule": "0 3 * * *"
       }
     ]
   }
   ```
   > `crons` 配置 Webhook 投递扫描，每天 03:00 UTC 触发 `/api/webhooks/dispatch`。
5. 配置环境变量（见 [环境变量](#aether-web必需) 章节）
6. 点击 **Deploy**

> **首次部署前**：确保 `DATABASE_URL` 已配置，且数据库 schema 已迁移。
> 生产部署会自动执行迁移（`VERCEL_ENV=production` 时 `scripts/vercel-build.mjs`
> 自动运行 `pnpm --filter @aether/db db:migrate`）。

---

### Step 2: 部署 aether-editor

1. **Add New → Project** → 导入同一仓库
2. **Root Directory** 设为 `apps/@aether/editor-host`
3. Framework Preset 选择 **Other**
4. `vercel.json` 已配置：
   ```json
   {
     "framework": null,
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "cd ../../.. && AETHER_EDITOR_HOST_BASE=/ pnpm turbo run build --filter=@aether/editor-host",
     "outputDirectory": "dist",
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```
   > `AETHER_EDITOR_HOST_BASE=/` 确保独立部署时资源路径正确（而非嵌入模式下的 `/editor/`）
5. 无需额外环境变量
6. 点击 **Deploy**

---

### Step 3: 部署 aether-converge (Cloudflare Workers)

#### 方式 A：Wrangler CLI 部署（推荐）

1. 确保已登录 Cloudflare（`wrangler login`，仅需一次）
2. 在仓库根目录执行：
   ```bash
   pnpm --filter @aether/converge-server deploy:cf
   ```
   该命令等价于 `wrangler deploy`，读取 `apps/@aether/converge-server/wrangler.toml` 配置。

#### 方式 B：Cloudflare Dashboard 连接 GitHub（自动部署）

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Import a repository**
2. 选择 Aether 仓库，**Root directory** 设为 `apps/@aether/converge-server`
3. **Build command**：`pnpm install --frozen-lockfile && pnpm turbo run build --filter=@aether/converge-server`
4. **Deploy command**：`pnpm --filter @aether/converge-server exec wrangler deploy`
5. 每次推送主分支自动重新部署

#### wrangler.toml 配置说明

```toml
# apps/@aether/converge-server/wrangler.toml
name = "aether-converge"          # Worker 名称（决定 *.workers.dev 子域名）
main = "cf/index.ts"              # 入口文件
compatibility_date = "2024-11-01" # CF 运行时兼容日期

# 按文档（docName）分片的 Yjs 房间 Durable Object
[[durable_objects.bindings]]
name = "YJS_ROOM"                 # 环境变量名（cf/index.ts 中通过 env.YJS_ROOM 访问）
class_name = "YjsRoom"            # DO 类名（cf/yjs-room.ts 中 export class YjsRoom）

# 免费计划仅支持 SQLite 存储后端的 Durable Object
[[migrations]]
tag = "v1"
new_sqlite_classes = ["YjsRoom"]  # 声明 YjsRoom 使用 SQLite 后端
```

#### Converge Server 端点说明

Converge Server 是纯 WebSocket 服务，没有前端页面。

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查，返回 `OK`（200） |
| `/ws/:docName` | WebSocket | Yjs 收敛服务（`:docName` 经 `encodeURIComponent` 编码） |

> `docName` 格式为 `{realmId}/{docRef}`，如 `realm-abc-123/current:doc-1`。
> 客户端（editor-host）的 `buildConvergeEndpoint()` 会自动编码并拼接路径。

测试连接：
```bash
# 健康检查
curl https://aether-converge.your-subdomain.workers.dev/health
# → OK

# WebSocket 端点（浏览器或 wscat）
wscat -c "wss://aether-converge.your-subdomain.workers.dev/ws/realm-abc%2Fcurrent-1"
```

#### Durable Object 持久化机制

- **每个文档一个 DO 实例**：`env.YJS_ROOM.idFromName(docName)` 按 docName 稳定分片
- **内存权威状态**：DO 实例内持有 `Y.Doc` + `Awareness`，所有连接共享同一实例
- **防抖落盘**：文档更新后 3 秒内无新更新则触发 `alarm()`，全量快照写入 DO Storage
- **分片存储**：快照按 128KB 分片，单次 `storage.put(values)` 原子写入；加载时按 `docMeta.chunkCount` 顺序读取
- **零外部依赖**：不连接 Postgres / Redis，状态完全持久化在 Cloudflare 边缘

---

### Step 4: 配置域名（可选）

#### Vercel 项目（web / editor-host）

在 Vercel 项目 → **Settings → Domains** 中添加自定义域名，按提示配置 DNS。

#### Cloudflare Worker（converge-server）

**方式 A：使用默认 `*.workers.dev` 域名**（零配置）
- 部署后自动获得 `https://aether-converge.<your-subdomain>.workers.dev`
- WebSocket 地址：`wss://aether-converge.<your-subdomain>.workers.dev`

**方式 B：绑定自定义域名**（Cloudflare Dashboard）
1. Workers & Pages → `aether-converge` → **Settings → Triggers → Custom Domains**
2. 添加 `sync.example.com`（域名需已在 Cloudflare DNS 管理）
3. WebSocket 地址：`wss://sync.example.com`

#### 域名建议

| 项目 | 建议域名 | 说明 |
|------|----------|------|
| aether-web | `aether.example.com` | 主站点 |
| aether-editor | `editor.example.com` | 编辑器 SPA |
| aether-converge | `sync.example.com` | WebSocket 服务 |

#### 绑定域名后更新环境变量

在 **aether-web** 的 Vercel 项目设置中更新：
- `BETTER_AUTH_URL` → `https://aether.example.com`
- `NEXT_PUBLIC_APP_URL` → `https://aether.example.com`
- `NEXT_PUBLIC_EDITOR_HOST_URL` → `https://editor.example.com`
- `NEXT_PUBLIC_CONVERGE_SERVER_URL` → `wss://sync.example.com`（CF Worker 基址，**不含** `/ws/:docName`，editor-host 会自动拼接）

> **关键**：`NEXT_PUBLIC_CONVERGE_SERVER_URL` 应设为 **Worker 基址**（如
> `wss://sync.example.com`），而非完整端点。editor-host 的
> `buildConvergeEndpoint(baseUrl, docName)` 会自动拼接为
> `wss://sync.example.com/ws/{encodeURIComponent(docName)}`。
>
> **向后兼容**：若该变量已设为旧版完整端点（以 `/ws` 或 `/api/ws` 结尾），
> `buildConvergeEndpoint` 会原样使用，不重复拼接。迁移期无需改动。

---

## 环境变量

### aether-web（必需）

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接 URL | `postgres://user:pass@host/db` |
| `BETTER_AUTH_URL` | 站点公开地址 | `https://aether.example.com` |
| `BETTER_AUTH_SECRET` | 会话签名密钥（`openssl rand -base64 32`） | |
| `NEXT_PUBLIC_APP_URL` | 前端公开的应用地址 | `https://aether.example.com` |
| `NEXT_PUBLIC_EDITOR_HOST_URL` | Editor Host 应用的公开地址（iframe 嵌入） | `https://editor.example.com` |
| `NEXT_PUBLIC_CONVERGE_SERVER_URL` | Converge Server 地址（CF Worker 基址） | `wss://sync.example.com` |

### aether-web（可选）

| 变量 | 说明 |
|------|------|
| `AETHER_AUTH_GUARD_ENABLED` | 鉴权守卫开关（默认 true） |
| `AETHER_ENTITLEMENT_ENABLED` | Entitlement Engine 强制判定开关（默认 false） |
| `AETHER_OIDC_DISCOVERY_URL` | OIDC Provider 发现地址（与 `AETHER_OIDC_CLIENT_ID` 成对） |
| `AETHER_OIDC_CLIENT_ID` | OIDC 客户端 ID |
| `AETHER_OIDC_CLIENT_SECRET` | OIDC 客户端密钥（PKCE public client 可省） |
| `AETHER_OIDC_PROVIDER_ID` | Provider 标识（默认 `oidc`） |
| `AETHER_OIDC_NAME` | 登录页显示名称（默认 `SSO`） |
| `AETHER_OIDC_SCOPES` | 空格分隔的 OAuth scopes（默认 `openid email profile`） |
| `AETHER_OIDC_PKCE` | 设为 `true` 时启用 PKCE |
| `AETHER_OIDC_ISSUER` | 显式 issuer 校验（RFC 9207） |
| `AETHER_SCIM_TOKEN` | SCIM 2.0 provisioning Bearer token（与 `AETHER_SCIM_REALM_ID` 成对，长度 ≥ 16） |
| `AETHER_SCIM_REALM_ID` | SCIM 管辖的 Realm id |
| `AETHER_MAIL_PROVIDER` | 邮件服务商：`console`（默认）或 `resend` |
| `RESEND_API_KEY` | Resend API Key（`AETHER_MAIL_PROVIDER=resend` 时必填） |
| `AETHER_MAIL_FROM` | 发件人地址（`AETHER_MAIL_PROVIDER=resend` 时必填） |
| `AETHER_INTEGRATION_ENCRYPTION_KEY` | 集成凭据加密密钥（base64 编码 32 字节；GitHub App / Webhook 时必填） |
| `AETHER_WEBHOOK_DISPATCH_TOKEN` | Webhook 投递扫描端点 Bearer token（Vercel Cron 鉴权） |
| `AETHER_GITHUB_APP_ID` | GitHub App numeric ID（Resonance Bridge） |
| `AETHER_GITHUB_APP_SLUG` | GitHub App slug |
| `AETHER_GITHUB_APP_PRIVATE_KEY` | GitHub App PEM 私钥（多行用 `\n` 转义） |
| `AETHER_GITHUB_WEBHOOK_SECRET` | GitHub Webhook 签名密钥 |

### aether-editor

无需环境变量。编辑器从 iframe URL 查询参数解析上下文（`realmId` / `filePath` /
`actorId` / `actorName` / `convergeUrl`）。

### aether-converge

**无需环境变量**。CF Workers 部署不依赖 Postgres / Redis，Yjs 文档状态持久化
在 Durable Object Storage 中。

---

## 自动数据库迁移

Vercel 部署 aether-web 时，会在**生产环境**（`VERCEL_ENV=production`）自动执行
数据库迁移。

### 触发规则

| 环境 | VERCEL_ENV | 迁移行为 |
|------|------------|----------|
| Production | `production` | ✅ 自动执行 |
| Preview | `preview` | ❌ 跳过 |
| Development | `development` | ❌ 跳过 |

### 工作原理

迁移逻辑在 `scripts/vercel-build.mjs`，`buildCommand` 调用该脚本：

```
buildCommand: cd ../../.. && node scripts/vercel-build.mjs && pnpm turbo run build --filter=@aether/web
```

脚本内容：
```javascript
// scripts/vercel-build.mjs
if (process.env.VERCEL_ENV === 'production') {
  execSync('pnpm --filter @aether/db db:migrate', { stdio: 'inherit' })
}
```

> 使用 Node.js 而非 Shell 脚本是为了兼容 Vercel 的 Linux 构建环境，避免 `sh`/`bash`
> 命令找不到或换行符问题。

### 手动触发迁移

如果需要在 Preview 环境或手动运行迁移，可以设置环境变量 `RUN_DB_MIGRATION=true`
并重新部署，或在本地执行：

```bash
pnpm db:migrate
```

### 迁移特性

- **幂等性**：`drizzle-kit migrate` 会自动跳过已应用的迁移
- **安全性**：迁移失败会中断构建（`process.exit(1)`），防止应用在 schema 不匹配时部署
- **可追溯**：迁移记录存储在 `packages/@aether/db/drizzle/` 目录

---

## Turborepo 构建说明

web 与 editor-host 共享同一 monorepo，通过 Turborepo 按 `--filter` 选择性构建：

```
Root Directory (Vercel)         Build Command
─────────────────────────────────────────────────────────────────────────────
apps/@aether/web              cd ../../.. && node scripts/vercel-build.mjs \
                                    && pnpm turbo run build --filter=@aether/web

apps/@aether/editor-host       cd ../../.. && AETHER_EDITOR_HOST_BASE=/ \
                                    pnpm turbo run build --filter=@aether/editor-host
```

> **路径说明**：Vercel `Root Directory` 设为 `apps/@aether/<app>`（3 层深度），
> `cd ../../..` 直接跳转到仓库根目录。从根目录运行 `pnpm turbo` 可正确解析
> workspace 结构。

`turbo.json` 中 `build` 任务声明了 `dependsOn: ["^build"]`，确保共享包
（`@aether/db`、`@aether/ui` 等）先于应用构建。

`DATABASE_URL`、`DATABASE_URL_UNPOOLED` 等环境变量已在 `turbo.json` 的
`globalEnv` 中声明，确保迁移时可用。

> **converge-server 不经过 Turborepo 构建**：CF Workers 使用 `wrangler deploy`
> 直接从 `cf/index.ts` 编译部署，不依赖 Turborepo 管线。`typecheck:cf` 使用
> 独立的 `tsconfig.cloudflare.json`（`include: ["cf/**/*.ts"]`）。

---

## 跨域跳转与会话共享

### Web 如何加载 Editor？

Aether 采用 **iframe 嵌入**模式，Web 项目通过环境变量 `NEXT_PUBLIC_EDITOR_HOST_URL`
指向独立部署的 Editor 应用：

```
Web (aether.example.com)
  └─ iframe src = "https://editor.example.com?realmId=xxx&filePath=/README.md&actorId=user-123&actorName=Alice&convergeUrl=wss://sync.example.com"
       └─ Editor (独立 Vite SPA)
            └─ HocuspocusProvider → wss://sync.example.com/ws/{docName}
```

Editor Host 从 URL 查询参数解析上下文：
- `realmId`: 当前 Realm 标识
- `filePath`: 需要打开的文件路径
- `actorId`: 当前用户 ID（用于 Presence 显示）
- `actorName`: 当前用户显示名
- `convergeUrl`: Converge Server 地址（CF Worker 基址）

### Editor 如何连接 Converge Server？

editor-host 的 `buildConvergeEndpoint(baseUrl, docName)` 负责拼接 WebSocket 端点：

```typescript
// CF Worker 基址 → 自动拼接 /ws/:docName
buildConvergeEndpoint('wss://sync.example.com', 'realm-abc/current-1')
// → 'wss://sync.example.com/ws/realm-abc%2Fcurrent-1'

// 旧版完整端点（以 /ws 或 /api/ws 结尾）→ 原样使用
buildConvergeEndpoint('wss://sync.example.com/api/ws', 'realm-abc/current-1')
// → 'wss://sync.example.com/api/ws'
```

### 如何共享登录状态？

由于 Web 和 Editor 是不同的 Vercel 项目（不同域名），默认情况下它们的 Cookie
是隔离的。要实现共享登录状态，需要：

#### 方案 A：父域名 Cookie（推荐）

如果两个项目部署在同一父域名下（如 `aether.example.com` 和 `editor.example.com`），
可以配置 Better-Auth 使用父域名 Cookie：

```typescript
// @aether/auth 配置中
createAuth({
  // ...
  options: {
    cookies: {
      session: {
        domain: '.example.com', // 父域名
        secure: true,
      }
    }
  }
})
```

#### 方案 B：Editor 独立认证

Editor Host 通过 Better-Auth 的 REST API（`/api/auth/session`）独立验证用户身份。
如果 Web 和 Editor 使用相同的后端数据库，可以实现单点登录（SSO）。

#### 方案 C：Token 传递（最安全）

通过一次性 Token 传递身份：Web 生成临时 Token → URL 参数传递给 Editor → Editor
验证 Token 后建立自己的会话。

> **注意**：当前实现使用**方案 A**（父域名 Cookie）。如果使用不同顶级域名
> （如 `aether.com` 和 `editor.io`），需要改用方案 B 或 C。

### 配置示例

#### 生产环境（同一父域名）

| 项目 | 域名 | Cookie 域 |
|------|------|-----------|
| aether-web | `aether.example.com` | `.example.com` |
| aether-editor | `editor.example.com` | `.example.com` |
| aether-converge | `sync.example.com` | N/A (WebSocket) |

**aether-web 环境变量：**
```
NEXT_PUBLIC_APP_URL=https://aether.example.com
NEXT_PUBLIC_EDITOR_HOST_URL=https://editor.example.com
NEXT_PUBLIC_CONVERGE_SERVER_URL=wss://sync.example.com
BETTER_AUTH_URL=https://aether.example.com
```

#### 本地开发

本地开发时，Editor Host 默认运行在 `http://localhost:5173`，Web 运行在
`http://localhost:3000`，Converge Server 运行在 `ws://localhost:1234`。
由于都在 `localhost` 域下，Cookie 默认可以共享。

在 Web 的 `.env.local` 中设置：
```
NEXT_PUBLIC_EDITOR_HOST_URL=http://localhost:5173
NEXT_PUBLIC_CONVERGE_SERVER_URL=ws://localhost:1234
```

---

## 本地开发

### 全量启动（Node 模式）

```bash
# 安装依赖
pnpm install

# 并行启动所有应用（web :3000 / editor :5173 / converge :1234）
pnpm dev
```

> 本地开发的 converge-server 使用 Node 进程入口（`src/index.ts` + Hocuspocus），
> 依赖 `DATABASE_URL`（Postgres `crdt_updates` 表持久化）。这与生产的 CF Workers
> 部署（DO Storage 持久化）是两套独立的持久化路径，仅本地开发使用 Node 模式。

### 单独启动 Converge Server（CF Workers 本地模拟）

```bash
# 使用 wrangler dev 在本地模拟 CF Workers 运行时（Miniflare）
pnpm --filter @aether/converge-server dev:cf
```

> `wrangler dev` 启动本地 Miniflare 模拟器，使用 DO Storage 本地 SQLite。
> 这是验证 CF 部署行为的推荐方式，不依赖 Postgres。

### 质量检查

```bash
pnpm typecheck       # 全项目类型检查（含 typecheck:cf）
pnpm lint            # ESLint
pnpm test            # Vitest
pnpm build           # 全量构建
```

---

## 验证清单

### aether-web

- [ ] 访问 `/login`，完成注册 → 登录 → 登出
- [ ] 访问 `/dashboard`，创建 Realm，自动跳转到 `/realm/[id]/current`
- [ ] Current 工作台三栏布局正常（文件树、编辑器 iframe、Entities）
- [ ] 点击文件，iframe 正确加载对应的 Editor URL
- [ ] 切换文件时，iframe 重新加载并显示新文件内容

### aether-editor

- [ ] 访问根路径，编辑器 SPA 正常加载（独立访问模式）
- [ ] 通过 Web 嵌入访问（iframe），编辑器正确解析 URL 参数
- [ ] 静态资源（JS/CSS）路径正确，无 404
- [ ] Presence 状态显示正常（在线用户列表）

### aether-converge

- [ ] `curl https://<worker-domain>/health` 返回 `OK`（200）
- [ ] `wscat -c "wss://<worker-domain>/ws/<docName>"` 连接成功（101 Upgrade）
- [ ] 两个客户端连接同一 `docName`，编辑内容实时同步
- [ ] 断开所有客户端后重连，文档状态恢复（DO Storage 持久化）
- [ ] Cloudflare Dashboard → Workers → `aether-converge` → **Logs** 无异常

---

## 常见问题

### 构建失败：`turbo: command not found`

确保 Root Directory 设置正确（如 `apps/@aether/web`），Vercel 会从仓库根目录
安装依赖（`pnpm install`），`turbo` 作为 devDependency 在根 `package.json` 中声明。

### 编辑器资源 404

确认 `vercel.json` 的 `buildCommand` 包含 `AETHER_EDITOR_HOST_BASE=/`。若缺少
该变量，Vite 会使用默认的 `/editor/` 子路径，导致独立部署时资源加载失败。

### WebSocket 连接失败：`Expected WebSocket`（426）

CF Workers 的 WebSocket 端点是 `/ws/:docName`，不是 `/api/ws`。确认
`NEXT_PUBLIC_CONVERGE_SERVER_URL` 设为 Worker **基址**（如 `wss://sync.example.com`），
editor-host 会自动拼接 `/ws/:docName`。如果误设为 `wss://sync.example.com/api/ws`，
CF Worker 会返回 404（该路径不存在）。

### Cloudflare 部署报错：`unrecognized migration`

`wrangler.toml` 中的 `[[migrations]]` 段声明了 Durable Object 类。首次部署时
`new_sqlite_classes = ["YjsRoom"]` 创建迁移标签 `v1`。如果之前部署过其他迁移
配置，可能需要先删除 Worker 再重新部署，或在 Cloudflare Dashboard 中重置迁移状态。

### Cloudflare 部署报错：`requires --paid-plan` 或 `unavailable in free tier`

`wrangler.toml` 已配置为免费计划兼容（SQLite 后端 DO）。如果误改为
`new_classes`（非 SQLite 后端），需要付费计划。保持 `new_sqlite_classes` 即可。

### 三个项目必须部署在同一 Vercel Team 下吗？

不是必须，但推荐。同一 Team 下可共享环境变量（Environment Variables 支持跨项目
复制），且 Preview Deployment 的域名互通更方便调试。

### converge-server 部署后 Yjs 数据在哪里？

Yjs 文档状态（CRDT 二进制快照）持久化在 Cloudflare Durable Object Storage 中
（SQLite 后端）。每个 `docName` 对应一个 DO 实例，存储在 Cloudflare 边缘节点。
**不回写 Postgres**。这与本地 Node 开发模式（`src/index.ts`，持久化到 Postgres
`crdt_updates` 表）是两套独立路径。

### 如何切换 converge-server 回 Node 自托管？

保留的 `src/index.ts` 入口支持 Node 进程部署（长驻服务，无连接时长限制）。
构建产物 `dist/index.js` 可直接 `node dist/index.js` 启动，需配置 `DATABASE_URL`
（Postgres 持久化）和可选 `REDIS_URL`（多实例广播）。适合需要将 Yjs 状态回写
Postgres 或在自有基础设施运行的场景。

---

## 部署目标对比

| 维度 | CF Workers DO（推荐生产） | Node 自托管（`src/index.ts`） | 本地开发（`pnpm dev`） |
|------|--------------------------|-------------------------------|------------------------|
| 入口 | `cf/index.ts` | `src/index.ts` | `src/index.ts` |
| 持久化 | DO Storage（SQLite） | Postgres `crdt_updates` | Postgres `crdt_updates` |
| WebSocket 时长 | 无限制 | 无限制 | 无限制 |
| 多实例广播 | 不需要（DO 单实例） | 需 Redis | 单实例 |
| 外部依赖 | 无 | Postgres + 可选 Redis | Postgres + 可选 Redis |
| 成本 | 免费 | 自有服务器成本 | 本地 |
| 部署命令 | `pnpm deploy:cf` | `node dist/index.js` | `pnpm dev` |
| 环境变量 | 无 | `DATABASE_URL` / `REDIS_URL` / `PORT` | 同左 |
