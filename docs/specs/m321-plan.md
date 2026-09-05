# Plan: M3.21 — Webhook 投递跨 Realm 隔离端到端验证

Spec: [m321-webhook-realm-isolation-e2e.md](./m321-webhook-realm-isolation-e2e.md)

## 实施顺序

1. **测试套件** `apps/@aether/web/tests/webhook-realm-isolation.test.ts`
   - mock 范式复用 `webhook-service.test.ts`：`getDb` / `authorizeRequest` /
     `recordAuditEntry` / `createLogger` / `getIntegrationEncryptionKey`
   - 双 Realm 固件：REALM_A / REALM_B、订阅 subA@urlA / subB@urlB、
     pending delivery 各一条
   - 真实 AES-GCM 往返：`randomBytes(32)` 生成加密密钥，双订阅各自 secret
2. **入队隔离用例**（3 项）：A/B 事件入队仅产生本 Realm delivery；信封 realm 一致
3. **投递隔离用例**（3 项）：dispatch 扫描双 Realm delivery，fetch 仅命中各自
   url；payload.realm.id 与订阅一致；签名由各自 secret 生成
4. **订阅方查询 / 删除隔离**（2 项）：令牌 A 查 / 删 B 订阅 → 404
5. **同 Realm 正向回归**（2 项）：A 事件入队 → dispatch 投递成功；A 查 A deliveries → 200
6. **门禁 + 文档**：milestones 勾选、docs/README 索引、spec 验收标准

## 文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `apps/@aether/web/tests/webhook-realm-isolation.test.ts` |
| 新建 | `docs/specs/m321-webhook-realm-isolation-e2e.md` |
| 新建 | `docs/specs/m321-plan.md` |
| 修改 | `docs/README.md`（索引 37/38） |
| 修改 | `docs/roadmap/milestones.md`（M3.21 备注） |

## 风险与对策

- **mock db 入队 select 拦截**：`enqueueWebhookDeliveries` 第一次 select
  查订阅匹配，需按入参 realmId 返回对应订阅。对策：mock 队列按调用顺序
  预置，断言 insert values 仅含本 Realm 订阅 id。
- **dispatch JOIN 查询 mock**：`dispatchPendingWebhooks` 的 select 含
  innerJoin，mock 链需支持。对策：复用 `webhook-service.test.ts` 的
  `makeChain`（含 `innerJoin`），返回双 Realm delivery 行（各含 subscription
  url / encrypted_secret）。
- **fetch 出站捕获**：用 `vi.stubGlobal('fetch', fn)` 捕获调用，断言 url
  集合与 payload.realm.id 对应关系，不发起真实网络。
- **不引入生产代码变更**：若用例暴露缺口，记录为后续 fix 任务，不在本里程碑内修复。
