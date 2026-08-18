# Spec: M3.8 — Entitlement Engine（细粒度授权引擎）

对应里程碑任务：M3 「Entitlement Engine：角色 / 作用域 / 资源三级判定」。

## 目标

在既有 `@aether/auth` Realm Tree 角色模型之上，提供一个**纯函数可测**的授权判定引擎，把"能不能进 Realm"细化到"能对哪个项目 / 哪个资源做什么"，并统一覆盖人类与 Entity 两类主体。

## 三级判定模型

判定输入为 `(subject, request)`，输出为 `EntitlementDecision`。三层依次收紧，任一层拒绝即终止：

| 层级 | 名称 | 数据来源 | 判定内容 |
|---|---|---|---|
| L1 | 角色（role） | `members.role` → `@aether/auth` `realmRoles` | 角色是否声明了 `resource:action` |
| L2 | 作用域（scope） | `members.project_id` | Realm 级成员（`project_id = null`）覆盖全 Realm；项目级成员仅覆盖同 `project_id` 的请求 |
| L3 | 资源（resource） | `members.entitlements` jsonb | 针对单资源的显式授权 / 显式否决 |

### L3 entitlements 键约定

`members.entitlements` 为 jsonb，键格式两种，值仅取布尔：

- `"<resource>:<action>"` —— 资源类型级覆盖，例如 `"thread:archive": false`
- `"<resource>:<action>:<resourceId>"` —— 单资源级覆盖，例如 `"current:converge:realm:abc/doc-1": true`

优先级：单资源级 > 资源类型级 > 角色判定。显式 `false` 永远拒绝（deny 优先），非布尔值视为未声明。

### Entity 主体的额外约束

沿用 `@aether/entity-core` 的「声明 ≠ 授权」原则：`actor_type = 'entity'` 的主体，**写类动作**（`create / update / delete / converge / drift / resolve / archive / manage_member`）必须在 `entitlements` 中拿到显式 `true` 才通过，仅有角色声明不足；读类动作（`read`）走常规三级判定。人类主体不受此约束。

## 公开 API（`@aether/entitlement`）

```ts
// 纯判定层（无 IO，可单测）
type EntitlementResource = 'realm' | 'project' | 'thread' | 'entity' | 'current' | 'audit'

interface EntitlementSubject {
  realmId: string
  actorType: ActorType          // 'human' | 'entity'
  actorId: string
  /** 该主体在此 Realm 下的成员记录（可多条：Realm 级 + 项目级） */
  memberships: readonly EntitlementMembership[]
}

interface EntitlementMembership {
  role: string                  // 'owner' | 'admin' | 'member' | 自定义
  projectId: string | null      // null = Realm 级作用域
  status: 'active' | 'invited' | 'suspended'
  entitlements: Record<string, unknown>
}

interface EntitlementRequest {
  resource: EntitlementResource
  action: string
  /** 资源所属项目；缺省表示 Realm 级请求 */
  projectId?: string
  /** 单资源标识，用于 L3 单资源级键匹配 */
  resourceId?: string
}

type EntitlementDenyReason =
  | 'no_membership'      // 无 active 成员记录
  | 'scope_mismatch'     // 成员作用域不覆盖请求项目
  | 'role_denied'        // 角色未声明该 statement
  | 'resource_denied'    // entitlements 显式否决
  | 'entity_not_granted' // Entity 写动作缺少显式授权

// 判别联合：allowed 决定 reason / matchedProjectId 的形态
type EntitlementDecision =
  | { allowed: true; layer: 'role' | 'resource'; reason: 'granted'; matchedProjectId?: string | null }
  | { allowed: false; layer: 'role' | 'scope' | 'resource'; reason: EntitlementDenyReason }

function evaluateEntitlement(subject: EntitlementSubject, request: EntitlementRequest): EntitlementDecision
function assertEntitlement(subject: EntitlementSubject, request: EntitlementRequest): void  // 拒绝时 throw EntitlementDeniedError
class EntitlementDeniedError extends Error { readonly reason: EntitlementDenyReason; readonly request: EntitlementRequest }

// 加载层（Drizzle IO，与判定层分离）
function loadEntitlementSubject(db, params: { realmId: string; actorType: ActorType; actorId: string }): Promise<EntitlementSubject>
```

判定顺序：`no_membership` → 逐条 membership 计算（`scope_mismatch` / `role_denied` / `resource_denied` / `entity_not_granted`），任一条 membership 通过即 allow；全部失败时返回**最具体**的拒绝原因（优先级：`resource_denied` > `entity_not_granted` > `role_denied` > `scope_mismatch`）。

## Web 接线

`apps/@aether/web/lib/auth-guard.ts` 增加 `requireEntitlement(...)`，在既有 `requireRealmAccess` 的 UUID + 存在性校验之后执行三级判定：

- 主体身份来自 `resolveCurrentActor()`（M3.8 阶段仍为占位，返回 `null`，SSO/SCIM 落地后接 Better-Auth session）。
- 环境变量 `AETHER_ENTITLEMENT_ENABLED`（默认 `false`）控制是否强制判定：
  - 未启用 → 记录一次 debug 日志后放行，保持 M1/M3.5 行为不变；
  - 已启用且主体无法解析 → 拒绝（fail-closed）。
- 接线点：`listAuditLogs` 判定 `audit:read`（承接代码审查 P2-18），`appendCurrentUpdate` 判定 `current:converge`（`resourceId` 用 doc_ref），`createThread` 判定 `thread:create`。web 层当前没有 Thread 更新 Server Action（`updateThread` 仅存在于 `@aether/thread-bindings` 底层，未被 web 使用），因此 `thread:update` 本次不接线，待 web 侧出现对应入口时补齐。

## 不在本次范围

- Better-Auth session 解析与真实登录流（M3 SSO / SCIM 任务）
- 授权变更的管理 UI（Entity 管理 UI 依赖此引擎，后续里程碑）
- 授权判定结果落 `audit_log`（Converge Telemetry 任务一并处理）

## 验收标准

- [x] `@aether/entitlement` 包内三级判定纯函数覆盖：角色允许/拒绝、Realm 级与项目级作用域、单资源与类型级 entitlements 覆盖（含 deny 优先）、Entity 写动作显式授权、非 active 成员拒绝
- [x] `loadEntitlementSubject` 经 Realm 隔离守卫（`@aether/db` `realmGuard`）读取 `members`，禁止手工拼接 `realm_id`
- [x] web 侧 `requireEntitlement` 在开关关闭时行为与现状一致，开启且无主体时 fail-closed
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿
- [x] docs 索引、README 包清单、milestones 任务勾选同 PR 更新
