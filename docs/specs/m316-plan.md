# Plan: M3.16 — Resonance Gateway（公开 REST API v1）

## 步骤

1. **审计写入泛化**
   - `lib/audit-write.ts` 追加 `recordAuditEntry(tx, input)`：支持 `audit_action` 全枚举
     （write / converse 等），`recordPermissionChange` 语义不变；Gateway 写操作与业务
     变更同事务调用。
2. **Web：Resonance 协议层纯函数**
   - 新建 `lib/resonance/protocol.ts`：错误体 `apiError` / 成功 `apiJson`、资源映射
     （realm / project / thread / entity / current / dialogue message）、分页解析与
     clamp、`createThreadInput` / `patchThreadInput` / `createDialogueInput` zod schema、
     Thread 状态机 `assertThreadStatusTransition`。
3. **Web：Resonance 鉴权层**
   - 新建 `lib/resonance/auth.ts`：`parseBearerKey`（aeth_ 前缀）、
     `resolveApiKey(db, authorization)`（sha256 → api_keys 查找 → realm 未删 →
     创建者 active membership 三重校验）、`touchLastUsed`。
4. **Web：Resonance 业务层**
   - 新建 `lib/resonance/service.ts`：`handleApiIndex / handleListRealms /
     handleGetRealm / handleListProjects / handleListThreads / handleCreateThread /
     handleGetThread / handlePatchThread / handleListDialogues / handleCreateDialogue /
     handleListEntities / handleListCurrents`。公共 `authorize(request, realmId?)`：
     鉴权 + 路径 Realm 匹配（不匹配 404）。写操作事务 + 审计。
5. **Web：路由（thin routes）**
   - `app/api/v1/route.ts`（GET）
   - `app/api/v1/realms/route.ts`（GET）
   - `app/api/v1/realms/[realmId]/route.ts`（GET）
   - `app/api/v1/realms/[realmId]/projects|threads|entities|currents/route.ts`（GET；threads 加 POST）
   - `app/api/v1/threads/[threadId]/route.ts`（GET/PATCH）
   - `app/api/v1/threads/[threadId]/dialogues/route.ts`（GET/POST）
6. **测试**
   - `tests/resonance-protocol.test.ts`：错误体结构、资源映射（时间戳 ISO、可空字段
     缺省）、分页 clamp、输入校验（title 长度 / role 枚举 / manifestation_url 合法
     URL）、状态机全迁移矩阵。
   - `tests/resonance-auth.test.ts`：Bearer 解析（缺失 / 坏 scheme / 非 aeth 前缀）、
     哈希查找命中 / 未命中 / 已吊销、创建者离场 fail-closed、Realm 软删除、
     `last_used_at` 更新。
   - `tests/resonance-service.test.ts`：401 / 跨 Realm 404、threads 列表过滤分页、
     创建 201 + 审计、PATCH 状态机、dialogue 首条回写 dialogue_ref + actor 归因、
     游标分页、entities / currents / projects / index 形状。
7. **文档同步**
   - README：公开 API 章节（鉴权、端点表、curl 示例）；`@aether/resonance` 包描述
     去掉「M3 占位」。
   - `docs/README.md` 索引、`docs/roadmap/milestones.md` Resonance Gateway 备注。
8. **质量检查与交付**
   - `pnpm typecheck` / `pnpm lint` / `pnpm test` / Web production build 全绿。

## 文件变更清单

| 操作 | 路径 |
|------|------|
| 修改 | `apps/@aether/web/lib/audit-write.ts` |
| 新建 | `apps/@aether/web/lib/resonance/protocol.ts` |
| 新建 | `apps/@aether/web/lib/resonance/auth.ts` |
| 新建 | `apps/@aether/web/lib/resonance/service.ts` |
| 新建 | `apps/@aether/web/app/api/v1/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/realms/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/realms/[realmId]/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/realms/[realmId]/projects/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/realms/[realmId]/threads/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/realms/[realmId]/entities/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/realms/[realmId]/currents/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/threads/[threadId]/route.ts` |
| 新建 | `apps/@aether/web/app/api/v1/threads/[threadId]/dialogues/route.ts` |
| 新建 | `apps/@aether/web/tests/resonance-protocol.test.ts` |
| 新建 | `apps/@aether/web/tests/resonance-auth.test.ts` |
| 新建 | `apps/@aether/web/tests/resonance-service.test.ts` |
| 修改 | `README.md` |
| 修改 | `docs/README.md` |
| 修改 | `docs/roadmap/milestones.md` |
| 新建 | `docs/specs/m316-resonance-gateway.md` |
| 新建 | `docs/specs/m316-plan.md` |

## 风险与注意事项

- Server Action 层与 `next/headers` 耦合，Gateway service 不得 import 任何
  `'use server'` 模块（`lib/api-keys.ts` 等），否则 Route Handler 上下文报错。
- `resolveApiKey` 必须先哈希再查库（key_hash 唯一索引），杜绝明文比对。
- 创建者 membership 校验要限定 realm 级（`project_id IS NULL`）且 `status='active'`，
  与 SCIM 回收路径（删 members 行）形成闭环。
- dialogue 首条消息的 `dialogue_ref` 回写存在并发窗口：两个并发首条消息可能各建
  dialogue_id；采用 `UPDATE ... SET dialogue_ref = <new> WHERE id = ? AND dialogue_ref
  IS NULL` + 失败方重读 thread 行后挂接既有 dialogue，保证幂等收敛。
- 跨 Realm 404 是安全语义，不要改成 403（避免存在性泄露）。
- 审计幂等键带 threadId / seq 等稳定标识，避免重试风暴下审计行爆炸。
- `limit` 必须服务端 clamp（默认 30 / max 100），不信任客户端入参。
