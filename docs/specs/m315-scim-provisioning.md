# Spec: M3.15 — SCIM 2.0 Provisioning 端点

M3「SSO / SCIM 接入」的后半段。M3.14 已完成 OIDC 外部 IdP 登录与 Web 登录 UI，但成员生命周期仍依赖站内邀请；企业 IdP（Azure AD / Okta / Entra ID）标准的人口配置协议是 SCIM 2.0（RFC 7643/7644）。Better-Auth 1.6.26 没有内置 SCIM 插件，本任务自研 SCIM Users 端点，打通「IdP 侧增删用户 → Better-Auth organization 成员 → Aether membership」的自动同步链路。

## 现状与缺口

1. 成员开通仅有两条路径：Realm 创建者隐式成为 owner（M3.10）、站内邀请（M3.10/M3.12）。企业场景要求 IdP 是唯一事实源：IdP 侧分配 / 回收应用，Aether 侧自动镜像。
2. `@aether/auth` 的 organization 封装面向用户会话（`auth.api.*` 带 `headers`），SCIM 是服务器到服务器调用，无用户会话。
3. better-auth `addMember` 端点支持 system action（body 带 `userId` 不传 headers，源码 `dist/plugins/organization/routes/crud-members.mjs` 已核对），可直接复用；用户创建与成员移除无对应 system action，走 auth 表的直接读写（沿用 M3.10 `findOrganizationMemberRoles` 直读 member 表的先例，封装在 `@aether/auth` 内部，下游不接触 better-auth 表结构）。

## 交付内容

### 1. 配置（环境变量驱动，单 Realm，与 OIDC 同款 fail-fast 策略）

| 变量 | 必填 | 说明 |
|---|---|---|
| `AETHER_SCIM_TOKEN` | 启用 SCIM 时必填 | Bearer token，长度 ≥ 16 |
| `AETHER_SCIM_REALM_ID` | 启用 SCIM 时必填 | 目标 Realm 的 Aether id（UUID） |

解析规则（纯函数，可单测）：

- 两者都未配置 → SCIM 关闭，路由一律 404（不向 IdP 泄露部署形态）；
- 只配置其一 → 抛可读错误（配置残缺属部署错误）；
- `AETHER_SCIM_TOKEN` 长度 < 16 或 `AETHER_SCIM_REALM_ID` 非 UUID → 抛可读错误（弱 token / 错误 realm id 属部署错误）。

目标 Realm 必须已绑定真实 organization（`auth_org_id` 非占位）；否则所有写操作返回 500 + 可读 detail（部署时序问题：应先建 Realm 再开 SCIM）。

### 2. `@aether/auth`：无会话成员目录封装

新建 `src/user-directory.ts`（直读写 auth 表，包内行为，不暴露 better-auth 类型）：

```ts
findAuthUserByEmail(db, email): Promise<AuthUserRecord | null>   // 精确匹配
findAuthUserById(db, id): Promise<AuthUserRecord | null>
createAuthUser(db, { name, email }): Promise<AuthUserRecord>     // emailVerified=true（IdP 已验证），id 用 crypto.randomUUID()
```

`src/organization.ts` 追加：

```ts
provisionOrganizationMember(auth, { organizationId, userId, role })  // auth.api.addMember system action
deleteOrganizationMember(db, { organizationId, userId }): Promise<boolean>  // 直接删 member 行，返回是否删除
```

### 3. SCIM 端点（`/api/scim/v2/*`，Route Handler）

鉴权：`Authorization: Bearer <token>`，constant-time 比较；失败返回 401 SCIM Error + `WWW-Authenticate: Bearer`。所有响应 content-type `application/scim+json`。

| 方法 / 路径 | 语义 |
|---|---|
| `GET /ServiceProviderConfig` | 声明 patch / filter / sort / paging 能力 |
| `GET /Users` | 列 organization 成员（含 userName eq 过滤、startIndex/count 分页） |
| `POST /Users` | 建用户 + organization member（role 固定 `member`）+ Aether membership 镜像 |
| `GET /Users/{id}` | 查单个成员（非成员返回 404） |
| `PATCH /Users/{id}` | 仅支持 `replace` `active`（true/false）与 `displayName`，Azure AD 的启用/禁用流即走此端点 |
| `DELETE /Users/{id}` | 回收：删 organization member + 删 Aether membership，保留 user 记录，返回 204 |

用户资源映射：SCIM `id` = Better-Auth user id；`userName` = email；`active` = 「在 organization member 表中有行」。externalId 不持久化（接受但忽略，见局限）。

关键语义：

- **POST 幂等冲突**：email 已存在用户 → 409（RFC 7644 §3.3）；已在 organization → 409。IdP 侧对 409 的标准反应是转 PATCH，链路收敛。
- **PATCH active=false / DELETE**：事务内删 auth `member` 行 + 删 Aether `members` 行 + 写 `permission_change` 审计。不删 `user` 行（软回收，保留 OIDC 再登录可能）。
- **PATCH active=true**：补 `member` 行（system action）+ `ensureRealmMembership` 重建 Aether membership。重复启用为幂等 no-op。
- **审计**：所有写操作以 `{ actor_type: 'entity', actor_id: 'scim' }` 落 `permission_change`（SCIM 服务主体，规范约定）；与 M3.10 JIT 镜像的审计格式一致。
- **过滤**：仅支持单个 `userName eq "email"`；不支持的 filter 返回 400（不静默忽略）。

### 4. Web 实现分层

- `lib/scim/config.ts` — `resolveScimConfig(env)` 纯函数；
- `lib/scim/protocol.ts` — SCIM 协议层纯函数：错误响应构造、ListResponse 构造、User→SCIM 资源映射、`userName eq` 过滤解析；
- `lib/scim/service.ts` — 业务层：`handleListUsers / handleCreateUser / handleGetUser / handlePatchUser / handleDeleteUser`，输入 `(db, auth, config, …)`，返回 `Response`，路由层零业务逻辑。

## 不在本次范围

- SCIM Groups（`/Groups` 端点）：角色→分组映射需产品决策，暂以 role 固定 `member` 兜底，分组能力另开 spec
- 多 Realm SCIM（本版 token 单 Realm 绑定；`api_keys` 表已为多凭据预留）
- `externalId` 持久化、displayName 之外的属性（photos/phoneNumbers/addresses）
- 角色 SCIM 化（enterprise extension roles）
- IdP 侧配置指引文档（README 记录端点与回调约定即可）

## 验收标准

- [x] 配置解析：全未配置关闭；只配其一抛错；token < 16 或 realmId 非 UUID 抛错
- [x] Bearer 鉴权 401（SCIM Error + WWW-Authenticate），constant-time 比较
- [x] POST /Users：创建用户 + org member + Aether membership + 审计，201；重复 email 409
- [x] GET /Users：分页 + userName eq 过滤；GET /Users/{id} 非成员 404
- [x] PATCH active=true/false 与 DELETE 语义正确、幂等、审计留痕；active 仅接受布尔
- [x] PATCH 未知 path / add / remove op 返回 400 SCIM Error
- [x] 未配置 SCIM 时路由 404；Realm 未绑定真实 org 时写操作 500 + 可读 detail
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm test` 与 Web production build 全绿
- [x] README 环境变量表、docs 索引、milestones SSO/SCIM 备注同步更新
