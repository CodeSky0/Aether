# Aether 全量部署到 Vercel

Aether 的三个应用均可部署到 Vercel：Web 主应用（Next.js）、编辑器宿主（Vite 静态）、
收敛服务（Hocuspocus WebSocket Function）。三者是独立的 Vercel 项目，共享同一个
GitHub 仓库（monorepo），通过各自的 Root Directory 分离。

## 架构总览

| 项目 | Root Directory | Framework | 产物 | 用途 |
|---|---|---|---|---|
| `@aether/web` | `apps/@aether/web` | Next.js（自动检测） | Next.js Functions + 静态 | 主站点：Realm / Thread / Audit / Current 编辑器 |
| `@aether/editor-host` | `apps/@aether/editor-host` | Vite（vercel.json 显式声明） | `dist/` 静态资源 | 编辑器宿主（Current 渲染层） |
| `@aether/converge-server` | `apps/@aether/converge-server` | Other（vercel.json `framework: null`） | `api/ws.ts` → `/api/ws` | Hocuspocus WebSocket 收敛（权威实时通道） |

数据层依赖：

- **PostgreSQL**：三个项目都读 `DATABASE_URL`。推荐 [Neon](https://neon.tech) 或
  [Supabase](https://supabase.com)（Vercel Marketplace 可直接集成）。
- **Redis**（converge-server 多实例广播，建议配置）：`REDIS_URL`。推荐
  [Upstash Redis](https://upstash.com)（`rediss://` TLS 协议，代码已适配）。

## 重要限制（WebSocket）

Vercel Function 对 WebSocket 连接有最大时长限制：

- Hobby：默认与最大均为 **300 秒**
- Pro：默认 300 秒，最大 **800 秒**（`vercel.json` 中可配 `maxDuration`）

连接到期后 Vercel 会关闭连接，客户端通过 Yjs 重连机制自动恢复并增量对账。
这是「全量上 Vercel」需要接受的取舍；若需要长驻连接，converge-server 也可改回
独立进程部署（`pnpm --filter @aether/converge-server start`）。

WebSocket 依赖 **Fluid compute**（2025-04-23 之后创建的新项目默认启用；
旧项目需在 Project Settings → Functions 确认开启）。

## 前置准备

1. 仓库已推送到 GitHub。
2. 准备好 PostgreSQL（`DATABASE_URL`）与 Redis（`REDIS_URL`，可选）。
3. 生成 Better-Auth 密钥：`openssl rand -base64 32`。

## 项目一：`@aether/web`（主站点）

1. Vercel 控制台 → **Add New → Project** → 导入本仓库。
2. **Root Directory** 设为 `apps/@aether/web`。
3. Framework Preset 自动识别为 Next.js，无需改构建命令。
4. 配置环境变量（Production 与 Preview 均需）：

   | 变量 | 说明 |
   |---|---|
   | `DATABASE_URL` | Postgres 连接 URL |
   | `BETTER_AUTH_URL` | 部署后的站点 URL，如 `https://your-app.vercel.app` |
   | `BETTER_AUTH_SECRET` | 会话签名密钥 |
   | `AETHER_ENTITLEMENT_ENABLED` | 按需设为 `true` 开启 Entitlement 强制判定 |
   | `AETHER_MAIL_PROVIDER` / `RESEND_API_KEY` / `AETHER_MAIL_FROM` | 生产邮件（可选） |
   | `AETHER_OIDC_*` | 外部 IdP（OIDC）SSO 配置（可选） |

   OIDC 回调地址在 IdP 侧登记为
   `${BETTER_AUTH_URL}/api/auth/oauth2/callback/<providerId>`。

5. 部署成功后，登录 / 注册 / SSO 均在 `/login`。

## 项目二：`@aether/editor-host`（编辑器宿主）

1. Vercel 控制台 → **Add New → Project** → 导入本仓库。
2. **Root Directory** 设为 `apps/@aether/editor-host`。
3. Framework Preset 识别为 Vite（`vercel.json` 已显式声明），Output 目录默认 `dist`。
4. 构建时 `VERCEL=1` 自动启用应用形态构建（见 `vite.config.ts`）。
5. 无需环境变量；未来接入 WebSocket 时按需配置 `NEXT_PUBLIC_CONVERGE_WS_URL`。

## 项目三：`@aether/converge-server`（WebSocket 收敛）

1. Vercel 控制台 → **Add New → Project** → 导入本仓库。
2. **Root Directory** 设为 `apps/@aether/converge-server`。
3. Framework Preset 选择 **Other**（`vercel.json` 已设 `framework: null`）。
4. 无需构建命令：`api/ws.ts` 会被 Vercel 自动编译为 Node.js Function，
   路由为 `/api/ws`。
5. 配置环境变量：

   | 变量 | 说明 |
   |---|---|
   | `DATABASE_URL` | Postgres 连接 URL（必需） |
   | `REDIS_URL` | Upstash Redis 连接 URL（可选，多实例广播必配） |

6. WebSocket 端点：`wss://<converge-domain>/api/ws`。

   > 每个 Vercel 部署都会获得独立的 `*.vercel.app` 域名。若三个项目希望共用
   > 一个域名，可在主站点项目添加 Rewrite / 用 Custom Domain 规划子域名
   > （如 `ws.your-domain.com` → converge-server 项目）。

### 提高 maxDuration（Pro 及以上）

默认 300 秒。Pro 可将 `apps/@aether/converge-server/vercel.json` 调整为：

```json
{
  "framework": null,
  "functions": {
    "api/ws.ts": {
      "maxDuration": 800,
      "memory": 1024
    }
  }
}
```

Hobby 不支持超过 300 秒，超配会导致部署失败。

## 客户端连接约定

前端（editor-host / web）连接收敛服务的约定端点：

```
wss://<converge-domain>/api/ws?realm=<realmId>&doc=<docRef>
```

Hocuspocus `documentName` 由 query 生成；`parseDocumentName` 已在
`apps/@aether/converge-server/src/document-name.ts` 实现 realm/doc 解析。
当前 M1 阶段 WebSocket 权威通道尚未接入客户端，实时协同走
`@aether/web` 的 Server Actions 降级通道（`app/actions/current.ts`）。

## 验证清单

1. **web**：访问 `/login`，能完成注册 / 登录 / 登出；编辑页面能保存。
2. **editor-host**：静态资源加载正常，编辑器可打开。
3. **converge-server**：`wss://<domain>/api/ws` 返回 101 Upgrade；
   `https://<domain>/api/ws`（无 upgrade 头）返回 200 文本
   `Aether converge-server (Vercel Function) is running`。
4. 查看 converge-server Function Logs，确认无
   `failed to create Hocuspocus instance` 报错（即 `DATABASE_URL` 已生效）。

## 本地开发不受影响

独立进程入口 `src/index.ts` 保持不变，本地仍可
`pnpm --filter @aether/converge-server dev` 启动长驻服务；
Vercel Function 入口为新增的 `src/vercel.ts` + `api/ws.ts`，两者共用
`src/hocuspocus.ts` 实例工厂，配置不会漂移。
