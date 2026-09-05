# Spec: M3.19 — OAuth App Registry

第三方应用通过标准 OAuth 2.0 授权码流程获得受管身份访问 Resonance Gateway
（`/api/v1`），权限按 Realm 委托——替代裸 API Key 分发给不可控的外部进程。

## 定位与模型

**Realm 级 App 注册（org-scoped app 模型）**：

```
第三方应用                    Aether（授权服务器 + 资源服务器）
   │ ①注册（realm owner/admin）      │
   │    ← client_id / client_secret ┤ oauth_apps（realm 绑定）
   │ ②引导用户授权                   │
   │ ── GET /oauth/authorize ──────→ │ 会话登录 + realm member 校验
   │    ← 同意页 ───────────────────┤
   │ ── POST /oauth/authorize ─────→ │ 生成一次性 code（10 min）
   │    ← 302 redirect_uri?code ────┤
   │ ③兑换令牌                       │
   │ ── POST /api/oauth/token ─────→ │ code + client_secret (+ PKCE)
   │    ← access_token (aoat_…) ────┤ oauth_authorizations（token 哈希入库）
   │ ④调用公开 API                   │
   │ ── Bearer aoat_… /api/v1 ─────→ │ 鉴权层双通道解析 + scope 强制
```

- **App 归属 Realm**：`oauth_apps.realm_id`；realm owner/admin 注册与管理。
  只有该 Realm 的 active human member 可完成授权（用户代表自己委托权限）。

- **Token 权限 = 授权用户的 Realm membership**（fail-closed，与 API Key
  完全一致的委托模型）：token 有效 + Realm 未软删除 + 授权用户仍是 active
  human member（realm 级）。用户离开 → token 立即失效；Realm 删除 → 全失效。

- **App 软删除** → 该 app 的授权与 token 全部失效。

## 数据模型

`oauth_apps`（App 注册）：

- `client_id`：`oapp_<16B base64url>`（唯一索引，公开标识）

- `client_secret_hash`：sha256 十六进制；明文 `osec_<32B base64url>` 仅创建
  时返回一次（与 API Key / Webhook secret 模式一致）+ `client_secret_prefix`
  展示前缀

- `redirect_uris`：jsonb 字符串数组，**精确匹配**（仅 https，例外
  `http://localhost`/`http://127.0.0.1` loopback 供开发期）

- `deleted_at` 软删除

`oauth_authorizations`（一次授权 = 一行，code 与 token 同行）：

- `(app_id, realm_id, user_id, scopes)`

- code 侧：`code_hash`（sha256，明文不落库）、`code_expires_at`（10 分钟）、
  `code_challenge` + `code_challenge_method`（S256，可选）、`exchanged_at`
  （非空即已兑换，一次性防重放）

- token 侧：`token_hash`（sha256，唯一索引，明文 `aoat_<32B base64url>` 仅
  兑换响应返回一次）、`token_prefix`、`token_issued_at`、`last_used_at`、
  `revoked_at`

- **Token 轮换收敛**：同一 `(app, user, realm)` 重新授权并兑换时，自动吊销
  该三元组下既有 token（对齐 GitHub 重新授权替换 token 的行为）。

- **v1 无过期 / 无 refresh token**：token 长期有效，生命周期管理 = 手动
  撤销 + fail-closed 失效（与 API Key 一致的有意决策；refresh token 留 v2）。

## 协议细节

### GET /oauth/authorize（授权入口，HTML）

查询参数：`client_id`、`redirect_uri`、`response_type=code`、`scope`
（空格分隔）、`state`、`realm_id`、可选 `code_challenge` +
`code_challenge_method=S256`。

校验失败（参数缺失 / app 不存在或已删 / redirect\_uri 不精确匹配 /
response\_type 非 code / method 非 S256 / scope 越界）→ 渲染错误页（400），
**不重定向**（防 open redirect）。校验通过且用户未登录 → 跳转登录页
（带回跳）。用户已登录但非该 Realm active member → 错误页（403 语义）。

通过 → 渲染同意页：App 名、client\_id、请求 scopes 的可读解释、授权身份
（当前用户）、批准 / 拒绝按钮。

### POST /oauth/authorize（用户决定）

批准 → 生成 code（哈希入库，10 分钟）→ 302 `redirect_uri?code&state`。
拒绝 → 302 `redirect_uri?error=access_denied&state`。
（CSRF 由同意页表单会话承载；state 透传回应用由其校验。）

### POST /api/oauth/token（JSON，机密客户端）

`grant_type=authorization_code` + `client_id` + `client_secret` +
`code` + `redirect_uri`（须与 authorize 一致）+ 可选 `code_verifier`。

- code 未过期 / 未兑换 / app 匹配 / redirect\_uri 匹配 / client\_secret
  恒时比较 / PKCE（authorize 带 challenge 则 verifier 必填且 S256 匹配）
  ——任一失败 `invalid_grant` / `invalid_client`（400/401，不泄露具体原因）

- 成功 → 同事务：标记 exchanged\_at + 吊销旧 token + 写入 token 哈希 +
  审计 → 响应 `{ access_token, token_type: 'Bearer', scope }`（201 语义，
  实际 200）

### Bearer aoat\_… 调用 /api/v1

`lib/resonance/auth.ts` 升级为**双通道解析**：`aeth_` 前缀走 API Key
（行为不变）；`aoat_` 前缀走 OAuth token → 三重 fail-closed 校验（token
未吊销 + Realm 存活 + 用户 active membership）→ 复用统一
`ResolvedApiKey` 形状，扩展 `kind: 'api-key' | 'oauth-token'`、
`appId`、`scopes`。

**Scope 强制**（仅 OAuth token；API Key 无 scope 概念保持全放行）：

- `read`：GET / HEAD

- `write`：POST / PATCH / DELETE

- 写操作缺 `write` scope → 403 `insufficient_scope`

审计归因：`oauth-app:<clientId>`（entity 服务主体，沿 `api-key:<id>` 惯例）；
dialogue 消息归因授权用户（human）——与 API Key「审计记密钥、消息记创建者」
模式对齐。

### 管理（Server Actions + UI）

realm owner/admin（`requireRealmRole`）：

- `registerOAuthApp`（name / redirect\_uris）→ 明文 secret 仅返回一次

- `listOAuthApps`（client\_id、前缀、创建时间、授权数）

- `rotateOAuthAppSecret` → 新明文仅返回一次（旧 secret 立即失效）

- `deleteOAuthApp`（软删除）

realm member（本人授权管理）：

- `listMyOAuthAuthorizations`（app 名、scopes、签发/最近使用时间）

- `revokeOAuthAuthorization`（吊销自己的 token）

UI：realm Settings → Integrations 页新增 OAuth Apps 卡片（注册 / 列表 /
轮换 / 删除）与「我的授权」区块（吊销）。

## Scope 目录（v1）

| scope   | 语义                                    |
| ------- | ------------------------------------- |
| `read`  | GET/HEAD 全部 `/api/v1` 读端点             |
| `write` | POST/PATCH/DELETE 写端点（含 webhook 订阅管理） |

默认（scope 参数缺省）= `read`。空格分隔请求（`read write`）。

## 安全清单

- client\_secret / code / access\_token 一律 sha256 哈希入库（库泄露不可重放）

- code 一次性（exchanged\_at）+ 10 分钟过期 + 绑定 app/redirect\_uri/PKCE

- client\_secret / token 比较走哈希后唯一索引查找（同 API Key，杜绝时序侧信道）

- redirect\_uri 精确匹配 + https 限定（loopback 例外）+ 校验失败不重定向

- App 删除 / token 吊销 / membership 失效 / realm 删除 → 全部 fail-closed

- 全部管理操作与授权/兑换/吊销落审计（`recordAuditEntry`，幂等键前缀
  `oauth:`）

## 不在本次范围

- refresh token / token TTL（与 API Key 生命周期对齐，v2 再议）

- 细粒度资源 scope（`threads:read` 等；M3.16 已声明 API Key scope 细化不在范围）

- 动态客户端注册（RFC 7591）、PKCE plain、隐式 / 密码 grant

- App 全局跨 Realm 注册（GitHub 个人 OAuth App 模型；realm 级更贴合多租户边界）

- Marketplace 商店页（P2 任务）

## 验收标准

- [ ] 第三方应用仅凭 `client_id/secret` + 浏览器授权完成闭环：注册 → 授权
  → 兑换 → Bearer 调用 `/api/v1` 读写资源

- [ ] code 重放 / 过期 / 错 app / 错 redirect\_uri / 错 secret / PKCE 不匹配
  全部拒绝；redirect\_uri 校验失败绝不重定向

- [ ] scope 强制：`read` token 调写端点 → 403 insufficient\_scope；API Key
  行为完全不变

- [ ] fail-closed：吊销 token / 删除 app / 用户失去 membership → 401

- [ ] 审计闭环：注册 / 授权 / 兑换 / 吊销 / 删除全部落审计

- [ ] `pnpm typecheck` / `lint` / `test` / `build` 全绿；文档同步

