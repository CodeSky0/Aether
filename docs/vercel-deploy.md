# Aether Vercel 部署指南

Aether monorepo 包含三个独立应用，分别部署为 **三个独立的 Vercel 项目**，各自拥有独立的 `vercel.json`、域名和部署流水线。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Vercel Organization                    │
├──────────────────┬──────────────────┬───────────────────┤
│   aether-web     │  aether-editor   │  aether-converge  │
│   (Next.js)      │  (Vite SPA)      │  (Function)       │
│   Root: apps/    │  Root: apps/     │  Root: apps/      │
│   @aether/web    │  @aether/        │  @aether/         │
│                  │  editor-host     │  converge-server  │
├──────────────────┼──────────────────┼───────────────────┤
│  默认域名:       │  默认域名:        │  默认域名:         │
│  *.vercel.app    │  *.vercel.app    │  *.vercel.app     │
│  (或自定义域名)   │  (或自定义域名)   │  (或自定义域名)    │
└──────────────────┴──────────────────┴───────────────────┘
         │                  │                  │
         │  iframe 嵌入     │  WebSocket 连接
         │  (NEXT_PUBLIC_   │  (CONVERGE_SERVER_URL)
         │   EDITOR_HOST_   │
         │   URL)           │
         └──────────────────┼──────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │     PostgreSQL (Neon)      │
              │     Redis (Upstash, 可选)   │
              └───────────────────────────┘
```

| 项目 | 包路径 | 框架 | 说明 |
|------|--------|------|------|
| **aether-web** | `apps/@aether/web` | Next.js 16 | 主站点：登录、Dashboard、Realm 管理、Current 工作台（通过 iframe 嵌入 Editor） |
| **aether-editor** | `apps/@aether/editor-host` | Vite 8 + React | 协同编辑器 SPA（Yjs），接收 URL 参数获取上下文 |
| **aether-converge** | `apps/@aether/converge-server` | Hocuspocus on Vercel Function | WebSocket 协同收敛服务 |

## 前置准备

### 1. 基础设施

| 资源 | 用途 | 推荐 |
|------|------|------|
| **PostgreSQL** | 三个应用共享数据库 | [Neon](https://neon.tech) 或 [Supabase](https://supabase.com) |
| **Redis**（可选） | converge-server 多实例广播 | [Upstash Redis](https://upstash.com)（`rediss://` TLS） |

### 2. 生成密钥

```bash
# Better-Auth 会话签名密钥
openssl rand -base64 32
```

### 3. 仓库

确保仓库已推送到 GitHub，且 `pnpm-lock.yaml` 已提交。

---

## 部署步骤

### Step 1: 数据库迁移

在部署应用之前，先确保数据库 schema 已就绪：

```bash
# 本地执行迁移（或配置 CI/CD 在部署前运行）
pnpm db:migrate
```

生产环境也可在 Vercel 部署后通过 Serverless Function 自动迁移。

---

### Step 2: 部署 aether-web

1. Vercel 控制台 → **Add New → Project**
2. 导入仓库，**Root Directory** 设为 `apps/@aether/web`
3. Framework Preset 自动识别为 **Next.js**
4. 构建命令和输出目录无需手动设置（已由 `vercel.json` 配置）：
   ```json
   {
     "framework": "nextjs",
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "cd ../.. && pnpm turbo run build --filter=@aether/web"
   }
   ```
5. 配置环境变量（见下方 [环境变量](#环境变量) 章节）
6. 点击 **Deploy**

---

### Step 3: 部署 aether-editor

1. **Add New → Project** → 导入同一仓库
2. **Root Directory** 设为 `apps/@aether/editor-host`
3. Framework Preset 选择 **Other**
4. `vercel.json` 已配置：
   ```json
   {
     "framework": null,
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "cd ../.. && AETHER_EDITOR_HOST_BASE=/ pnpm turbo run build --filter=@aether/editor-host",
     "outputDirectory": "dist",
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```
   > 注意：`AETHER_EDITOR_HOST_BASE=/` 确保独立部署时资源路径正确（而非嵌入模式下的 `/editor/`）
5. 无需额外环境变量
6. 点击 **Deploy**

---

### Step 4: 部署 aether-converge

1. **Add New → Project** → 导入同一仓库
2. **Root Directory** 设为 `apps/@aether/converge-server`
3. Framework Preset 选择 **Other**
4. `vercel.json` 已配置：
   ```json
   {
     "framework": null,
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "cd ../.. && pnpm turbo run build --filter=@aether/converge-server",
     "functions": {
       "api/ws.ts": {
         "memory": 1024,
         "maxDuration": 300
       }
     }
   }
   ```
5. 配置环境变量：`DATABASE_URL`（必需）、`REDIS_URL`（可选）
6. 点击 **Deploy**

> **WebSocket 限制**：Vercel Function 对 WebSocket 连接有最大时长限制 —— Hobby 300 秒，Pro 最大 800 秒。连接到期后客户端通过 Yjs 重连机制自动恢复。如需长驻连接，converge-server 可独立部署为 Node.js 进程。

---

### Step 5: 配置域名（可选）

为每个项目绑定自定义域名：

| 项目 | 建议域名 | 说明 |
|------|----------|------|
| aether-web | `aether.example.com` | 主站点 |
| aether-editor | `editor.example.com` | 编辑器 |
| aether-converge | `sync.example.com` | WebSocket 服务 |

在 Vercel 项目 → **Settings → Domains** 中添加，然后按提示配置 DNS。

绑定后需更新 Web 项目的环境变量：
- `BETTER_AUTH_URL` → `https://aether.example.com`
- `NEXT_PUBLIC_APP_URL` → `https://aether.example.com`
- `CONVERGE_SERVER_URL` → `https://sync.example.com`

---

## 环境变量

### aether-web（必需）

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接 URL | `postgres://user:pass@host/db` |
| `BETTER_AUTH_URL` | 站点公开地址 | `https://aether.example.com` |
| `BETTER_AUTH_SECRET` | 会话签名密钥（`openssl rand -base64 32`） | |
| `NEXT_PUBLIC_APP_URL` | 前端公开的应用地址 | `https://aether.example.com` |

### aether-web（可选）

| 变量 | 说明 |
|------|------|
| `AETHER_OIDC_DISCOVERY_URL` | OIDC Provider 发现地址 |
| `AETHER_OIDC_CLIENT_ID` | OIDC 客户端 ID |
| `AETHER_OIDC_CLIENT_SECRET` | OIDC 客户端密钥 |
| `AETHER_OIDC_PROVIDER_ID` | Provider 标识（默认 `oidc`） |
| `AETHER_OIDC_NAME` | 登录页显示名称（默认 `SSO`） |
| `AETHER_ENTITLEMENT_ENABLED` | 启用 Entitlement Engine（M3） |
| `AETHER_MAIL_PROVIDER` | 邮件服务商 |
| `RESEND_API_KEY` | Resend API Key |
| `AETHER_MAIL_FROM` | 发件人地址 |

### aether-converge（必需）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接 URL（与 web 共用同一数据库） |

### aether-converge（可选）

| 变量 | 说明 |
|------|------|
| `REDIS_URL` | Upstash Redis 连接 URL（多实例广播必配） |

### aether-editor

无需额外环境变量。

---

## Turborepo 构建说明

三个项目共享同一 monorepo，通过 Turborepo 按 `--filter` 选择性构建：

```
Root Directory (Vercel)    Build Command
─────────────────────────────────────────────────────────────
apps/@aether/web           cd ../.. && pnpm turbo run build --filter=@aether/web
apps/@aether/editor-host   cd ../.. && AETHER_EDITOR_HOST_BASE=/ pnpm turbo run build --filter=@aether/editor-host
apps/@aether/converge-server  cd ../.. && pnpm turbo run build --filter=@aether/converge-server
```

`turbo.json` 中 `build` 任务声明了 `dependsOn: ["^build"]`，确保共享包（`@aether/db`、`@aether/ui` 等）先于应用构建。

---

## 跨域跳转与会话共享

### Web 如何加载 Editor？

Aether 采用 **iframe 嵌入**模式，Web 项目通过环境变量 `NEXT_PUBLIC_EDITOR_HOST_URL` 指向独立部署的 Editor 应用：

```
Web (aether.example.com)
  └─ iframe src = "https://editor.aether.example.com?realmId=xxx&filePath=/README.md&actorId=user-123&actorName=Alice"
       └─ Editor (独立 Vite SPA)
```

Editor Host 从 URL 查询参数解析上下文：
- `realmId`: 当前 Realm 标识
- `filePath`: 需要打开的文件路径
- `actorId`: 当前用户 ID（用于 Presence 显示）
- `actorName`: 当前用户显示名

### 如何共享登录状态？

由于 Web 和 Editor 是不同的 Vercel 项目（不同域名），默认情况下它们的 Cookie 是隔离的。要实现共享登录状态，需要：

#### 方案 A：父域名 Cookie（推荐）

如果两个项目部署在同一父域名下（如 `aether.example.com` 和 `editor.example.com`），可以配置 Better-Auth 使用父域名 Cookie：

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

Editor Host 可以通过 Better-Auth 的 REST API 独立验证用户身份：

1. 用户在 Web 登录后，Session Cookie 只在 Web 域有效
2. Editor Host 加载时，通过 Better-Auth REST API（`/api/auth/session`）验证当前会话
3. 如果 Web 和 Editor 使用相同的后端数据库，可以实现单点登录（SSO）

#### 方案 C：Token 传递（最安全）

通过一次性 Token 传递身份：

1. Web 在生成 iframe URL 前，向后端请求一个临时 Token
2. Token 通过 URL 参数传递给 Editor：`?token=xxx`
3. Editor 验证 Token 后建立自己的会话

> **注意**：当前实现使用**方案 A**（父域名 Cookie）。如果使用不同顶级域名（如 `aether.com` 和 `editor.io`），需要改用方案 B 或 C。

### 配置示例

#### 生产环境（同一父域名）

| 项目 | 域名 | Cookie 域 |
|------|------|-----------|
| aether-web | `aether.example.com` | `.example.com` |
| aether-editor | `editor.example.com` | `.example.com` |
| aether-converge | `sync.example.com` | N/A (WebSocket) |

需要设置的环境变量：

**aether-web:**
```
NEXT_PUBLIC_EDITOR_HOST_URL=https://editor.example.com
CONVERGE_SERVER_URL=https://sync.example.com
BETTER_AUTH_URL=https://aether.example.com
```

**aether-editor (如果需要独立认证):**
```
NEXT_PUBLIC_APP_URL=https://editor.example.com
BETTER_AUTH_URL=https://editor.example.com
BETTER_AUTH_SECRET=<same as web>
DATABASE_URL=<same as web>
```

#### 本地开发

本地开发时，Editor Host 默认运行在 `http://localhost:5173`，Web 运行在 `http://localhost:3000`。由于都在 `localhost` 域下，Cookie 默认可以共享。

在 Web 的 `.env.local` 中设置：
```
NEXT_PUBLIC_EDITOR_HOST_URL=http://localhost:5173
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

- [ ] `wss://<domain>/api/ws` 返回 101 Upgrade
- [ ] `https://<domain>/api/ws`（无 upgrade 头）返回 200 文本 `Aether converge-server is running`
- [ ] Function Logs 无 `failed to create Hocuspocus instance` 报错

---

## 常见问题

### 构建失败：`turbo: command not found`

确保 Root Directory 设置正确（如 `apps/@aether/web`），Vercel 会从仓库根目录安装依赖（`pnpm install`），`turbo` 作为 devDependency 在根 `package.json` 中声明。

### 编辑器资源 404

确认 `vercel.json` 的 `buildCommand` 包含 `AETHER_EDITOR_HOST_BASE=/`。若缺少该变量，Vite 会使用默认的 `/editor/` 子路径，导致独立部署时资源加载失败。

### WebSocket 连接频繁断开

Vercel Function 的 `maxDuration` 限制所致。Hobby 计划上限 300 秒，无法调整。Pro 计划可调至 800 秒：

```json
{
  "functions": {
    "api/ws.ts": {
      "maxDuration": 800,
      "memory": 1024
    }
  }
}
```

客户端 Yjs 重连机制会在断开后自动恢复，这是「全量上 Vercel」的已知取舍。

### 三个项目必须部署在同一 Vercel Team 下吗？

不是必须，但推荐。同一 Team 下可共享环境变量（Environment Variables 支持跨项目复制），且 Preview Deployment 的域名互通更方便调试。

### iframe 加载白屏或无法访问

检查以下几点：
1. **CORS 配置**：Editor Host 需要允许被 Web 域嵌入。在 `index.html` 中添加：
   ```html
   <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self' https://aether.example.com">
   ```
   或者在 Vercel 项目设置中配置 Security Headers。
2. **iframe sandbox 属性**：当前实现使用了 `sandbox="allow-scripts allow-same-origin allow-forms"`，确保必要的权限已开启。
3. **Cookie SameSite 策略**：跨站 iframe 时，Cookie 需要设置为 `SameSite=None; Secure`。

### iframe 中用户会话丢失

如果 Web 和 Editor 使用不同父域名（如 `aether.com` 和 `editor.io`），Cookie 默认无法跨域共享。解决方案：
1. **使用方案 C（Token 传递）**：在生成 iframe URL 时附带临时 Token
2. **Editor 独立调用 Better-Auth REST API**：在 Editor 初始化时验证会话

### 本地开发如何调试跨域？

本地开发时，Web 运行在 `http://localhost:3000`，Editor 运行在 `http://localhost:5173`。由于都在 `localhost` 域下，Cookie 可以正常共享。

```bash
# 终端 1：启动 Web
cd apps/@aether/web && pnpm dev

# 终端 2：启动 Editor
cd apps/@aether/editor-host && pnpm dev

# 终端 3：启动 Converge Server (可选)
cd apps/@aether/converge-server && pnpm dev
```

在 Web 的 `.env.local` 中设置：
```
NEXT_PUBLIC_EDITOR_HOST_URL=http://localhost:5173
```

### 本地开发

本地开发不受部署方式影响：

```bash
# 启动所有应用
pnpm dev

# 或单独启动
pnpm --filter @aether/web dev
pnpm --filter @aether/editor-host dev
pnpm --filter @aether/converge-server dev
```
