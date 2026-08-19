# Spec: M3.14 — SSO（OIDC）接入与登录 UI

M3「SSO / SCIM 接入」的 IdP 侧任务。M3.9–M3.12 已补齐服务端会话主体解析、membership provisioning（邀请 + JIT 镜像）、邀请邮件与成员管理 UI，但外部 IdP 登录链路不存在，浏览器侧也没有任何登录入口。本任务接入 OIDC 协议的外部 IdP，并补上 Web 登录 UI，让「SSO 登录 → organization 成员 → JIT 镜像 → Realm 访问」整条链路对真实用户可达。

## 现状与缺口

1. `createAuth`（`@aether/auth/src/instance.ts`）的透传层显式 `Omit<..., 'plugins'>`，下游无法注册 Better-Auth 的 `genericOAuth` 插件；没有任何外部 IdP 接入点。
2. Web 已有 `/api/auth/*` route handler 与 `emailAndPassword`（M3.9），但没有登录 / 注册 / 登出页面，用户无法在浏览器建立会话；`resolveCurrentActor()` 对真实用户永远返回 `null`。
3. Better-Auth 1.6.26 自带 `genericOAuth` 插件（`dist/plugins/generic-oauth`），支持 OIDC discovery、PKCE、issuer 校验（RFC 9207），无需引入新依赖。

## 交付内容

### 1. `@aether/auth`：OIDC provider 配置注入

```ts
export interface OidcProviderConfig {
  providerId: string            // 稳定标识，用于回调路由与登录按钮
  name: string                  // 登录按钮显示名（如 "企业 SSO"）
  discoveryUrl: string          // IdP 的 .well-known/openid-configuration
  clientId: string
  clientSecret?: string         // public client（PKCE）可省
  scopes?: string[]             // 默认 ['openid', 'email', 'profile']
  pkce?: boolean                // 默认 false
  issuer?: string               // 显式 issuer 校验（RFC 9207）
}

// 纯映射函数（可单测）：显式构造 redirectURI = `${baseURL}/api/auth/oauth2/callback/${providerId}`
function toGenericOAuthConfig(config: OidcProviderConfig, baseURL: string): GenericOAuthConfigLike
```

- `CreateAuthOptions` 新增 `oauthProviders?: readonly OidcProviderConfig[]`；非空时在既有 `organization` 插件之外追加注册 `genericOAuth({ config })`。
- `GenericOAuthConfigLike` 由本包自行声明（better-auth 的插件入参结构子集），下游与 Web 均不直接 import better-auth。
- 不传 `oauthProviders`（或传空数组）时实例行为与现状完全一致。

### 2. Web：环境变量驱动的单 provider 配置

| 变量 | 必填 | 说明 |
|---|---|---|
| `AETHER_OIDC_DISCOVERY_URL` | 启用 OIDC 时必填 | IdP discovery 文档 URL |
| `AETHER_OIDC_CLIENT_ID` | 启用 OIDC 时必填 | OAuth client id |
| `AETHER_OIDC_CLIENT_SECRET` | 否 | confidential client 填；PKCE public client 可省 |
| `AETHER_OIDC_NAME` | 否 | 按钮显示名，默认 `SSO` |
| `AETHER_OIDC_PROVIDER_ID` | 否 | 默认 `oidc` |
| `AETHER_OIDC_SCOPES` | 否 | 空格分隔，默认 `openid email profile` |
| `AETHER_OIDC_PKCE` | 否 | `true` 时启用 |
| `AETHER_OIDC_ISSUER` | 否 | 显式 issuer 校验 |

解析规则（`lib/auth.ts` 内的纯函数，可单测）：

- 两者都未配置 → 不注册 provider，行为与现状一致；
- 只配置其一 → **创建实例时抛出可读错误**（配置残缺属于部署错误，不允许静默降级）；
- `AETHER_OIDC_PKCE` 仅接受字面量 `true` 为开启，其余值（含空串）视为关闭。

IdP 侧回调地址约定：`${BETTER_AUTH_URL}/api/auth/oauth2/callback/${providerId}`。

### 3. `/login` 页面

- auth 未配置（`tryGetAuth()` 为 null）→ 页面渲染可读提示（缺 `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET`），不渲染表单，不 500。
- Email / Password：登录与注册同一表单切换，fetch Better-Auth 标准 REST 端点（`POST /api/auth/sign-in/email`、`POST /api/auth/sign-up/email`），成功后跳 `/`；失败显示 Better-Auth 返回的错误消息（`code` / `message`），不明文吞错。
- OIDC：仅当 provider 已配置时渲染按钮；`POST /api/auth/sign-in/oauth2`（body `{ providerId, callbackURL: '/' }`）→ 响应 `{ url }` → `window.location.assign(url)` 跳转 IdP。
- 不支持 `?next=` 回跳（开放重定向风险），统一跳 `/`。
- Web 不引入 `better-auth/client`；全部走 REST 端点，遵守「下游不直接依赖 better-auth」约束。

### 4. NavShell 用户态

- 新增 client 组件 `UserMenu`：挂载时 `GET /api/auth/get-session`（带 cookie）；已登录显示用户 email 截断 + 登出按钮（`POST /api/auth/sign-out` 后 `router.refresh()`）；未登录或请求失败显示「登录」链接指向 `/login`。
- 请求失败（auth 未配置、网络错误）一律按未登录处理，不抛错、不 500。

### 5. OIDC 用户与 Realm membership 的衔接（既有链路，无新代码）

OIDC 首次登录会按 email 匹配 / 创建 Better-Auth user；此后沿用 M3.10 的 JIT 镜像：`requireEntitlement` → `ensureRealmMembership` → organization 成员镜像为 Aether membership。不在 organization 的 OIDC 用户在 `AETHER_ENTITLEMENT_ENABLED=true` 时照常 fail-closed，与本地方登录行为一致。

## 不在本次范围

- SCIM provisioning 端点（独立 spec，SSO/SCIM 任务的后半段）
- 多 OIDC provider 并存（`oauthProviders` API 天然支持数组，Web 环境变量组本版只接一个）
- SAML（Better-Auth 无内置插件，需要时另评估）
- `?next=` 登录回跳、organization 切换 UI、密码找回
- Presence 光标身份的服务端校验

## 验收标准

- [x] `createAuth({ oauthProviders })` 注册 genericOAuth 插件；不传时实例行为与现状一致；`toGenericOAuthConfig` 的 redirectURI / 默认 scopes / pkce 映射有单测
- [x] OIDC 环境变量解析：全未配置不启用；只配一个时抛可读错误；`PKCE` 仅 `true` 开启
- [x] `/login`：auth 未配置显示可读提示；email 登录 / 注册 / OIDC 发起可用；错误可见
- [x] NavShell 显示会话态并支持登出；未配置 auth 时按未登录渲染
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm test` 与 Web production build 全绿
- [x] README 环境变量表、docs 索引、milestones SSO/SCIM 备注同步更新
