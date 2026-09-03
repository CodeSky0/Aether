# Plan: M3.15 — SCIM 2.0 Provisioning 端点

## 步骤

1. **`@aether/auth`：无会话成员目录封装**
   - 新建 `src/user-directory.ts`：`findAuthUserByEmail` / `findAuthUserById` / `createAuthUser`（直读写 auth `user` 表，id 用 `crypto.randomUUID()`）。
   - `src/organization.ts` 追加 `provisionOrganizationMember`（`auth.api.addMember` system action）与 `deleteOrganizationMember`（直删 member 行）。
   - `src/index.ts` 导出；新建 `tests/user-directory.test.ts`。
2. **Web：SCIM 协议层纯函数**
   - 新建 `lib/scim/config.ts`：`resolveScimConfig(env)`（成对校验、token ≥ 16、realmId UUID）。
   - 新建 `lib/scim/protocol.ts`：SCIM 常量、`scimError(status, detail)`、`toScimUserResource`、`toListResponse`、`parseUserNameFilter`。
3. **Web：SCIM 业务层**
   - 新建 `lib/scim/service.ts`：Bearer 鉴权、Realm/org 解析（占位 org 500）、五个 handler（list/create/get/patch/delete），写操作事务 + 审计 + `ensureRealmMembership` 复用。
4. **Web：路由**
   - `app/api/scim/v2/ServiceProviderConfig/route.ts`（GET）
   - `app/api/scim/v2/Users/route.ts`（GET/POST）
   - `app/api/scim/v2/Users/[id]/route.ts`（GET/PATCH/DELETE）
   - 未配置 SCIM → 404；路由层只做参数透传。
5. **测试**
   - `tests/scim-config.test.ts`：三种配置态 + 非法 token/realmId。
   - `tests/scim-protocol.test.ts`：错误结构、资源映射、过滤解析、分页。
   - `tests/scim-service.test.ts`：鉴权、create/409、patch active 流转、delete、未绑定 org 500、审计调用。
6. **文档同步**
   - README 环境变量表（`AETHER_SCIM_*`）+ IdP 配置说明（Bearer token、`/api/scim/v2/*` 端点）。
   - `docs/README.md` 索引、`docs/roadmap/milestones.md` SSO/SCIM 备注。
7. **质量检查与交付**
   - `pnpm typecheck` / `pnpm lint` / `pnpm test` / Web production build 全绿。

## 文件变更清单

| 操作 | 路径 |
|------|------|
| 新建 | `packages/@aether/auth/src/user-directory.ts` |
| 新建 | `packages/@aether/auth/tests/user-directory.test.ts` |
| 修改 | `packages/@aether/auth/src/organization.ts` |
| 修改 | `packages/@aether/auth/src/index.ts` |
| 新建 | `apps/@aether/web/lib/scim/config.ts` |
| 新建 | `apps/@aether/web/lib/scim/protocol.ts` |
| 新建 | `apps/@aether/web/lib/scim/service.ts` |
| 新建 | `apps/@aether/web/app/api/scim/v2/ServiceProviderConfig/route.ts` |
| 新建 | `apps/@aether/web/app/api/scim/v2/Users/route.ts` |
| 新建 | `apps/@aether/web/app/api/scim/v2/Users/[id]/route.ts` |
| 新建 | `apps/@aether/web/tests/scim-config.test.ts` |
| 新建 | `apps/@aether/web/tests/scim-protocol.test.ts` |
| 新建 | `apps/@aether/web/tests/scim-service.test.ts` |
| 修改 | `README.md` |
| 修改 | `docs/README.md` |
| 修改 | `docs/roadmap/milestones.md` |
| 新建 | `docs/specs/m315-scim-provisioning.md` |
| 新建 | `docs/specs/m315-plan.md` |

## 风险与注意事项

- `addMember` system action 依赖 body 显式 `organizationId`（无会话时不能走 activeOrganization 默认值）。
- 直写 auth 表必须封装在 `@aether/auth` 内，Web 不 import better-auth 类型/表。
- member 行删除后 Aether membership 必须同步删，否则 JIT 快路径仍放行（membership 残留 = 权限残留）。
- `ensureRealmMembership` 只做「补」，不做「删」；SCIM 回收路径必须显式删 Aether membership。
- SCIM token 是高权限凭据（直接开通成员），长度下限与 fail-fast 是安全底线，不做静默降级。
- 审计 actor 固定 `{ actor_type: 'entity', actor_id: 'scim' }`，规范约定写入 spec，避免与真实 Entity 混淆。
- PATCH 的 value 可能是布尔或字符串 `"true"`（部分 IdP 的已知怪癖），需规范化后校验，非法值 400。
