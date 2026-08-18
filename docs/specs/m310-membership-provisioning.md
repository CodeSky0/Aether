# Spec: M3.10 — Membership Provisioning（成员开通：邀请 + JIT 镜像）

M3.9 把会话主体接进了 `resolveCurrentActor()`，但 `AETHER_ENTITLEMENT_ENABLED=true` 仍然不可用：Aether `members` 表没有任何开通路径，登录用户永远查不到 membership，`loadEntitlementSubject` 返回空 memberships → 一律 fail-closed。本任务补上开通链路，让 enforcement 真正可开。

## 现状与缺口

1. `createRealm`（`apps/@aether/web/lib/realms.ts`）把 `auth_org_id` 写成占位值 `org-placeholder-${Date.now()}`，Realm 与 Better-Auth organization 从未绑定，organization 插件的邀请/成员 API 无从落地。
2. Realm 创建者不会成为任何 member，冷启动时无人具备 `realm:manage_member`，开通链路自己也没有起点。
3. `members` 表没有唯一约束，任何开通逻辑都无法幂等 upsert。
4. Better-Auth 的 `member` 表（organization 插件）与 Aether `members` 表是两套记录，缺少同步点；SSO/SCIM 后续接入时同样需要这个同步点。

## 关键约束（已在 better-auth 1.6.26 源码核对）

- `createAuth` 设了 `allowUserToCreateOrganization: false`，因此**用户自助**创建 organization 会 403。但 `createOrganization` 端点存在 system action 路径：不传 `headers`、在 body 里带 `userId` 时（`isSystemAction`）跳过该限制（`dist/plugins/organization/routes/crud-org.mjs`）。Realm 绑定走这条路径，创建者按 `creatorRole: 'owner'` 成为 org owner。
- organization 插件的 `role` 可以是逗号分隔的多角色字符串。
- `organization.slug` 全局唯一，Realm slug 亦唯一，直接复用 Realm slug 作为 org slug。

## 交付内容

### 1. `@aether/auth`：organization 操作封装

下游仍禁止直连 better-auth，新增薄封装（返回 Better-Auth 原始结果，不自造领域语义）：

```ts
createRealmOrganization(auth, { name, slug, ownerUserId })  // system action：不传 headers，body 带 userId
findOrganizationMemberRoles(db, { organizationId, userId }): Promise<string[]>  // 读 auth member 表，拆分逗号分隔角色
inviteToOrganization(auth, headers, { organizationId, email, role })
listOrganizationInvitations(auth, headers, { organizationId })
acceptOrganizationInvitation(auth, headers, { invitationId })
```

### 2. `members` 唯一约束（含迁移）

新增两个 partial unique index，使开通逻辑可幂等 upsert（Postgres 唯一索引里 NULL 互不冲突，故必须拆两个）：

```sql
CREATE UNIQUE INDEX members_realm_actor_uniq
  ON members (realm_id, actor_type, actor_id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX members_project_actor_uniq
  ON members (realm_id, project_id, actor_type, actor_id) WHERE project_id IS NOT NULL;
```

若现有数据存在重复行，迁移会失败——这是期望行为（重复 membership 本身是脏数据），需人工清理，不要在迁移里删数据。

### 3. Realm 创建时绑定 organization 并开通 owner

`createRealm`：当 auth 已配置且存在会话时，

1. 经 `createRealmOrganization` 建 organization（system action，ownerUserId = 会话用户）；
2. `realms.auth_org_id` 写真实 org id；
3. 同时写入创建者的 Aether membership：`{ actor_type: 'human', actor_id: sessionUserId, role: 'owner', project_id: null, status: 'active' }`；
4. 写一条 `audit_log` `permission_change`。

无会话或 auth 未配置时**保持现有占位行为**、不写 member 行（开发态无回归，与 M3.9 的降级策略一致）。Realm 行与 membership 行在同一事务内写入；organization 创建失败则整体失败，不留下半绑定的 Realm。

### 4. JIT 镜像

`ensureRealmMembership({ realmId, actorType, actorId })`：

1. Aether `members` 已有 active 行 → 直接返回（快路径，不触碰 auth 表）；
2. 否则用 `realms.auth_org_id` 查 Better-Auth `member`：命中则把角色镜像为单条 Aether membership（realm 级、`project_id = null`、`status = 'active'`、`entitlements = {}`），逗号分隔的多角色按 `owner > admin > member` 取最高已知角色，未知角色跳过并 warn；
3. 写入用 `onConflictDoNothing` 幂等，并对新增行写 `audit_log` `permission_change`；
4. 未命中 → 不写任何行，enforcement 继续 fail-closed。

接线点：`requireEntitlement` 在 `loadEntitlementSubject` 之前调用，且仅在 enforcement 开启并解析到 actor 时调用（关闭态零额外查询）。占位 `auth_org_id`（`org-placeholder-*`）天然查不到 organization member，因此对既有数据是 no-op。

### 5. 邀请链路（Server Actions，本次不做 UI）

- `inviteRealmMember({ realmId, email, role })` — 要求 `realm:manage_member`；
- `listRealmInvitations({ realmId })` — 要求 `realm:read`；
- `acceptRealmInvitation({ invitationId })` — 接受后立即 `ensureRealmMembership` 镜像，使 Aether 侧当场可用。

Realm 未绑定真实 organization（`auth_org_id` 仍是占位）时，这三个 action 必须抛出可读错误，说明该 Realm 需先重建/绑定 organization —— 不要静默成功。role 仅接受 `owner | admin | member`（与 `realmRoles` 的 key 对齐），其他值拒绝。

## 不在本次范围

- 邀请邮件真实投递（`createAuth` 里仍是 console.log 占位）
- 邀请 / 成员管理 UI
- 既有占位 `auth_org_id` 的 Realm 的回填迁移（需产品决策，脚本另开任务）
- project 级 membership 的开通（本次只开通 realm 级，`project_id = null`）
- Entity 主体的 membership 开通（Entity 不经浏览器会话）

## 验收标准

- [x] `members` 两个 partial unique index 已加并生成迁移；重复数据导致迁移失败属预期，不在迁移里删数据
- [x] 有会话时 `createRealm` 绑定真实 org、创建者获得 owner membership、审计留痕；无会话时行为与现在完全一致
- [x] `ensureRealmMembership` 幂等、按最高权限角色镜像多角色、未命中不写入、关闭态不产生额外查询
- [x] 三个邀请 Server Action 的授权分别为 `realm:manage_member` / `realm:read` / 会话自身；未绑定 org 时报可读错误
- [x] `AETHER_ENTITLEMENT_ENABLED=true` 时，绑定了 org 的 Realm 中其成员可正常读写，非成员仍 fail-closed
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿；新增测试覆盖幂等、多角色拆分、未命中、占位 org、角色白名单
- [x] README / docs 索引 / milestones 同步更新
