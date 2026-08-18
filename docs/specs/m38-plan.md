# Plan: M3.8 — Entitlement Engine

## 步骤

1. **新建 `@aether/entitlement` 包**
   - 按 `@aether/entity-core` 的包结构补齐 package、TypeScript、ESLint 与 Vitest 配置。
   - 纯判定层实现角色、作用域、资源三级判定与 `EntitlementDeniedError`。
   - 加载层通过 `realmGuard(members, realmId)` 查询主体在 Realm 内的全部成员记录。
2. **补充三级判定单测**
   - 覆盖角色允许/拒绝、Realm 级与项目级作用域、类型级与单资源级 entitlement。
   - 覆盖 deny 优先、Entity 写动作显式 `true`、非 active 成员、多 membership 任一通过与最具体拒绝原因。
3. **接入 Web 授权守卫**
   - 在 `auth-guard.ts` 增加 `resolveCurrentActor` 占位与 `requireEntitlement`。
   - 由 `AETHER_ENTITLEMENT_ENABLED` 控制强制判定，默认关闭时保持现有行为。
   - 接入 `listAuditLogs`、`appendCurrentUpdate` 与 `createThread`。
   - `thread:update` 本次不接线：Web 当前没有 Thread 更新 Server Action，底层 `@aether/thread-bindings` 的 `updateThread` 不属于 Web 入口，待后续 Web 入口补齐。
4. **同步 workspace 与项目文档**
   - 通过 `pnpm install` 更新 workspace lockfile。
   - 更新文档索引、项目包清单、环境变量表、monorepo 结构与 M3 任务状态。
   - 完成本规范验收清单。
5. **执行质量检查并交付**
   - 依次执行 `pnpm typecheck`、`pnpm lint` 与 `pnpm test`，修复所有由本次变更引起的问题。
   - 在 `converge/entitlement/engine` 分支提交并推送，不创建 PR。

## 文件变更清单

| 操作 | 路径 |
|------|------|
| 新建 | `packages/@aether/entitlement/package.json` |
| 新建 | `packages/@aether/entitlement/tsconfig.json` |
| 新建 | `packages/@aether/entitlement/tsconfig.build.json` |
| 新建 | `packages/@aether/entitlement/eslint.config.mjs` |
| 新建 | `packages/@aether/entitlement/vitest.config.ts` |
| 新建 | `packages/@aether/entitlement/src/evaluate.ts` |
| 新建 | `packages/@aether/entitlement/src/loader.ts` |
| 新建 | `packages/@aether/entitlement/src/index.ts` |
| 新建 | `packages/@aether/entitlement/tests/evaluate.test.ts` |
| 新建 | `packages/@aether/entitlement/tests/loader.test.ts` |
| 修改 | `apps/@aether/web/lib/auth-guard.ts` |
| 修改 | `apps/@aether/web/lib/audit.ts` |
| 修改 | `apps/@aether/web/app/actions/current.ts` |
| 修改 | `apps/@aether/web/lib/threads.ts` |
| 修改 | `pnpm-lock.yaml` |
| 修改 | `README.md` |
| 修改 | `docs/README.md` |
| 修改 | `docs/roadmap/milestones.md` |
| 修改 | `docs/roadmap/monorepo-structure.md` |
| 修改 | `docs/specs/m38-entitlement-engine.md` |
| 新建 | `docs/specs/m38-plan.md` |

## 风险与注意事项

- `realmRoles` 是角色权限表的唯一来源，Entitlement Engine 不重复维护角色 statement。
- `members` 查询必须使用 `@aether/db` 的 `realmGuard`，不能手工拼接 `realm_id`。
- `AETHER_ENTITLEMENT_ENABLED` 默认关闭，关闭时仅保留现有 Realm UUID 与存在性校验，并记录 debug 日志。
- M3.8 阶段 `resolveCurrentActor()` 返回 `null`；启用授权开关时必须 fail-closed。
- `members.entitlements` 来自 JSONB，读取时使用 `unknown` 类型守卫；非布尔值视为未声明。
- Entity 写动作必须有 entitlement 中显式的 `true`，人类主体不受此额外约束。
- Web 暂无 Thread 更新入口，因此 `thread:update` 不在本次接线范围内。
