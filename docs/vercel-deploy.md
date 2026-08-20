# Aether 全量部署到 Vercel

Aether 的三个应用（Web 主站点、编辑器宿主、Hocuspocus WebSocket 收敛服务）
统一部署为一个 Vercel 项目，共享同一个域名。

## 架构总览

| 组件 | 来源 | 部署路径 | 说明 |
|---|---|---|---|
| Web 主站点 | `apps/@aether/web` | `/` | Next.js：Realm / Thread / Audit / 登录 |
| 编辑器宿主 | `apps/@aether/editor-host` | `/editor/` | Vite 构建，SPA，由 Next.js rewrites 路由 |
| WebSocket 收敛 | `apps/@aether/converge-server` | `/api/ws` | Hocuspocus Function，Hobby 300s / Pro 800s 最大时长 |

数据层依赖：

- **PostgreSQL**：三个应用共享 `DATABASE_URL`。推荐 [Neon](https://neon.tech) 或
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

## 部署步骤

1. Vercel 控制台 → **Add New → Project** → 导入本仓库。
2. **Root Directory** 保持为空（即项目根目录 `/`）。
3. Framework Preset 自动识别为 **Next.js**。
4. 构建命令无需修改（`vercel.json` 已配置 `pnpm run vercel-build`：先构建 Editor Host 并复制到 Web 的静态目录，再构建 Next.js，最后将完整产物复制到根目录 `.next` 并校验静态资源）。输出目录必须为 `.next`；请清除 Vercel 项目设置中遗留的 `apps/@aether/web/.next` 或其他输出目录覆盖。
5. 配置环境变量（Production 与 Preview 均需）：

   | 变量 | 说明 |
   |---|---|
   | `DATABASE_URL` | Postgres 连接 URL（必需） |
   | `REDIS_URL` | Upstash Redis 连接 URL（可选，多实例广播必配） |
   | `BETTER_AUTH_URL` | 部署后的站点 URL，如 `https://your-app.vercel.app` |
   | `BETTER_AUTH_SECRET` | 会话签名密钥 |
   | `AETHER_ENTITLEMENT_ENABLED` | 按需设为 `true` 开启 Entitlement 强制判定 |
   | `AETHER_MAIL_PROVIDER` / `RESEND_API_KEY` / `AETHER_MAIL_FROM` | 生产邮件（可选） |
   | `AETHER_OIDC_*` | 外部 IdP（OIDC）SSO 配置（可选） |

   OIDC 回调地址在 IdP 侧登记为
   `${BETTER_AUTH_URL}/api/auth/oauth2/callback/<providerId>`。

6. 触发部署。构建完成后访问 `<your-app>.vercel.app`。

## 提高 maxDuration（Pro 及以上）

将根目录 `vercel.json` 中 converge-server function 的 `maxDuration` 改为 800：

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

Hobby 不支持超过 300 秒，超配会导致部署失败。

## 路由说明

| 路径 | 处理方 | 说明 |
|---|---|---|
| `/` | Next.js (web) | 主站点所有路由 |
| `/api/auth/*` | Next.js (web) | Better-Auth 认证路由 |
| `/api/ws` | converge-server Function | Hocuspocus WebSocket 端点 |
| `/editor/*` | Web 的 `public/editor` 静态目录 | Editor Host SPA 与静态资源 |

## 验证清单

1. **主站点**：访问 `/login`，能完成注册 / 登录 / 登出；编辑页面能保存。
2. **编辑器**：访问 `/editor`，静态资源加载正常，编辑器可打开。
3. **WebSocket**：`wss://<domain>/api/ws` 返回 101 Upgrade；
   `https://<domain>/api/ws`（无 upgrade 头）返回 200 文本
   `Aether converge-server (Vercel Function) is running`。
4. 查看 converge-server Function Logs，确认无
   `failed to create Hocuspocus instance` 报错（即 `DATABASE_URL` 已生效）。

## 本地开发不受影响

独立进程入口 `src/index.ts` 保持不变，本地仍可
`pnpm --filter @aether/converge-server dev` 启动长驻服务；
Vercel Function 入口为新增的 `src/vercel.ts` + `api/ws.ts`，两者共用
`src/hocuspocus.ts` 实例工厂，配置不会漂移。
