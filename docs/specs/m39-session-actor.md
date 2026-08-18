# Spec: M3.9 — Session Actor Resolution（会话主体解析）

M3「SSO / SCIM 接入」的前置任务。目标不是接入外部 IdP，而是补上**服务端主体解析**这条缺失的链路，让 M3.8 落地的 Entitlement Engine 具备可用前提，并消除客户端伪造 actor 的缺口。外部 IdP（OIDC / SAML）配置与 SCIM provisioning 端点仍留在后续任务。

## 现状与缺口

1. `apps/@aether/web` 不依赖 `@aether/auth`，没有 Better-Auth 实例、没有 auth route handler、没有会话；`resolveCurrentActor()` 是永远返回 `null` 的占位，因此 `AETHER_ENTITLEMENT_ENABLED` 一旦开启所有接线点必然 fail-closed。
2. `appendCurrentUpdate` 的入参携带客户端传来的 `actorType` / `actorId`（`lib/current/channel-service.ts` `AppendUpdateInput`），服务端原样落 `crdt_updates`，任何调用方都能冒充任意主体写入。
3. `members.actor_id` 是 `uuid`，而 Better-Auth `user.id` 是 `text`（非 UUID）。会话用户无法与 `members` 行对应，`loadEntitlementSubject` 对人类主体永远查不到 membership。同表族的 `crdt_updates` / `audit_log` / `dialogue_messages` 的 `actor_id` 已是 `text`（注释即写明「支持 Entity UUID 或 auth identity」）。

## 交付内容

### 1. `@aether/auth`：会话主体解析

新增会话解析导出（下游禁止直接依赖 better-auth，一律经本包）：

```ts
export interface SessionActor {
  actorType: 'human'          // Entity 主体不经浏览器会话，由 Entity 运行时注入
  actorId: string             // Better-Auth user.id
  /** Better-Auth session.activeOrganizationId，即当前 Realm；无则 null */
  activeRealmId: string | null
}

/** 经 auth.api.getSession({ headers }) 解析当前请求主体；无会话返回 null */
export function resolveSessionActor(auth: AuthInstance, headers: Headers): Promise<SessionActor | null>
```

### 2. `members.actor_id` 改为 text（含迁移）

`members.actor_id`: `uuid` → `text`，与 `crdt_updates` / `audit_log` / `dialogue_messages` 对齐，语义为「Entity UUID 或 auth identity」。索引 `members_actor_idx` 保持不变。

仓库目前**没有任何已提交的迁移文件**（`packages/@aether/db/drizzle/` 不存在），与 team-norms 第 2 节冲突。本次用 Drizzle Kit 生成并提交基线迁移（离线 `generate`，不需要连库），使 schema 与迁移自此有唯一事实源。生成后需人工 review SQL：确认基线包含全部现有表、枚举与索引，且 `members.actor_id` 为 `text not null`。

### 3. web：Better-Auth 实例与 route handler

- `lib/auth.ts`：经 `@aether/auth` 的 `createAuth` 创建单例（复用 `lib/db.ts` 的 Drizzle 实例），`baseURL` 取 `BETTER_AUTH_URL`，`secret` 取 `BETTER_AUTH_SECRET`。本阶段启用 `emailAndPassword`，社交 / SSO provider 留空。
- auth route handler 挂在 `/api/auth/*`（具体写法以 `node_modules/next/dist/docs/` 中本仓库 Next 16 的 Route Handler 文档为准）。
- 缺少 `BETTER_AUTH_SECRET` 时按 Next 的失败方式明确报错，不静默用默认密钥。

### 4. `resolveCurrentActor` 落地

`apps/@aether/web/lib/auth-guard.ts` 的 `resolveCurrentActor()` 改为经 `resolveSessionActor` + 请求头解析真实会话，无会话仍返回 `null`（`AETHER_ENTITLEMENT_ENABLED=true` 时继续 fail-closed）。开关默认值保持 `false`，本次不改变默认行为。

#### 认证未配置时的降级行为

当 `BETTER_AUTH_URL` 或 `BETTER_AUTH_SECRET` 任一未配置时，Web 不创建 Better-Auth 实例，`resolveCurrentActor()` 记录一次性告警并返回 `null`。因此 Current 写入在非强制鉴权的开发环境中继续使用 `human/web-client` 作为服务端注入的退化主体；若 `AETHER_ENTITLEMENT_ENABLED=true`，缺少认证主体仍会 fail-closed，不会因为降级而放宽授权。若会话解析本身抛错，也采用相同的 `null` 返回和 fail-closed 行为。

### 5. 消除客户端 actor 伪造

`appendCurrentUpdate` Server Action 的入参**移除** `actorType` / `actorId`，改为服务端解析：

```diff
-appendCurrentUpdate({ realmId, docRef, serializedPayload, actorType, actorId, idempotencyKey })
+appendCurrentUpdate({ realmId, docRef, serializedPayload, idempotencyKey })
+// 服务端：actor = (await resolveCurrentActor()) ?? { actorType: 'human', actorId: WEB_CLIENT_ACTOR_ID }
```

- 有会话 → 用会话主体；无会话 → 退化为系统客户端标识 `web-client`（`crdt_updates.actor_id` 是 text，schema 注释已允许系统客户端名），保证匿名开发态仍可写入，且**客户端再也无法指定 actor**。
- `lib/current/channel-service.ts` 的纯函数层 `AppendUpdateInput` 保持带 actor 字段（服务端注入），仅 Server Action 的对外契约收窄。
- `components/current-editor.tsx` 停止向写入路径传 actor；Presence 光标身份仍走客户端（临时状态、不落库），不在本次收窄范围。

## 不在本次范围

- 外部 IdP（OIDC / SAML）配置与登录 UI
- SCIM provisioning 端点与用户/组同步
- `members` 行的自动开通（邀请 / JIT provisioning）——因此启用开关前仍需手工写入 membership
- Presence 光标身份的服务端校验

## 验收标准

- [x] `@aether/auth` 导出 `resolveSessionActor`，web 不直接依赖 better-auth
- [x] `members.actor_id` 为 `text`，基线迁移已提交且人工 review 通过
- [x] `/api/auth/*` handler 已按 Next 16 Route Handler 规范接线
- [x] `resolveCurrentActor()` 在有会话时返回会话主体，无会话返回 `null`；`AETHER_ENTITLEMENT_ENABLED` 默认仍为 `false`
- [x] `appendCurrentUpdate` 的 Server Action 契约不再接受 actor 字段，客户端调用点同步收窄；无会话时落库 actor 为 `web-client`
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿，`@aether/web` 既有 channel-service 测试同步更新
- [x] docs 索引、README 环境变量表（`BETTER_AUTH_URL` / `BETTER_AUTH_SECRET`）、milestones 备注同 PR 更新
