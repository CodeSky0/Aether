# Plan: M3.20 — Realm Isolation 生产级验证

Spec: [m320-realm-isolation-verification.md](./m320-realm-isolation-verification.md)

## 实施顺序

1. **测试套件** `apps/@aether/web/tests/realm-isolation.test.ts`
   - mock 范式复用 `resonance-service.test.ts`：`getDb` / `authorizeRequest` /
     `enqueueWebhookDeliveries` / `recordAuditEntry` / `createLogger`
   - 双 Realm 固件：REALM_A / REALM_B、令牌 KEY_A（绑定 A）、
     Thread / Project 各两套（分属 A、B）
   - mock db 工厂：`select` 链按 where `realm_id` 返回对应行；
     `requireThreadRow` 按 (realmId, threadId) 命中
2. **路径守卫用例**（7 项）：`/realms/B/*` 全部 → 404
3. **资源守卫用例**（4 项）：`/threads/<B-thread>` GET/PATCH/dialogues → 404
4. **列表隔离用例**：A 令牌列表查询 where `realm_id = A`，mock 返回仅 A 行
5. **写隔离用例**：A 令牌创建 Thread 引用 B 的 project_id → 400 invalid_project
6. **同 Realm 正向回归**（3 项）：A 令牌正常访问 A 资源 → 200
7. **门禁 + 文档**：milestones 勾选、docs/README 索引、spec 验收标准

## 文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `apps/@aether/web/tests/realm-isolation.test.ts` |
| 新建 | `docs/specs/m320-realm-isolation-verification.md` |
| 新建 | `docs/specs/m320-plan.md` |
| 修改 | `docs/README.md`（索引 35/36） |
| 修改 | `docs/roadmap/milestones.md`（M3.20 勾选 + 备注） |

## 风险与对策

- **mock db where 拦截精度**：mock 需正确模拟 `eq(realm_id, X)` 过滤行为。
  对策：mock 按入参 realm_id 返回预置行集合，断言响应 data 仅含 A 行。
- **路径守卫先于 body 解析**：POST /realms/B/threads 应 404 而非 400。
  对策：`requireRealmMatch` 在 `readJsonBody` 之前执行（service.ts 已保证）。
- **不引入生产代码变更**：若用例暴露缺口，记录为后续 fix 任务，不在本里程碑内修复。
