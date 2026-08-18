# M3.13 Audit Vault 导出规范

Audit Vault 的台账在 M3.6 已落地（append-only + SHA-256 payload hash）。本节补上**导出**：把 Realm 的审计台账以 CSV / JSONL 交付给合规与取证流程。

## 端点

```
GET /api/realms/:realmId/audit/export
```

| 查询参数 | 取值 | 默认 |
|---|---|---|
| `format` | `csv` \| `jsonl` | `csv` |
| `actorType` | `human` \| `entity` | 不过滤 |
| `action` | `read` \| `write` \| `permission_change` \| `converse` \| `execute` | 不过滤 |
| `from` | ISO 时间戳，`created_at >= from` | 不过滤 |
| `to` | ISO 时间戳，`created_at <= to` | 不过滤 |

非法取值返回 `400` 而不是静默忽略：导出物会被当作合规证据，过滤条件被吞掉会给出错误的完整性印象。

响应状态：

| 状态 | 条件 |
|---|---|
| `401` | 无会话主体（`resolveCurrentActor()` 返回 null） |
| `400` | 查询参数非法（`AuditExportQueryError`）或 `realmId` 不是 UUID |
| `403` | entitlement 判定拒绝，或 Realm 级 membership 角色不足 |
| `404` | 通过授权后 Realm 不存在（例如并发删除或关闭基础守卫） |
| `503` | 授权依赖（数据库 / 配置）暂时不可用 |
| `200` | 流式附件响应 |

## 授权

```ts
const actor = await resolveCurrentActor()
await requireEntitlement(realmId, { resource: 'audit', action: 'read' })
await requireRealmRole(realmId, actor, READ_MEMBER_ROLES) // owner | admin | member
```

`requireEntitlement` 在 `AETHER_ENTITLEMENT_ENABLED !== 'true'` 时直接放行，所以导出**必须**再过 `requireRealmRole`——否则开关关闭状态下任一已登录用户可导出任意 Realm 的全量审计台账。

授权前不会查询 Realm 是否存在：不存在 Realm 与无权访问 Realm 的请求统一按 403 处理，避免已登录的非成员枚举租户。授权依赖发生数据库或配置故障时返回 503，服务端记录诊断日志但不向客户端泄露内部错误。

## 流式与分页

响应体是 `ReadableStream`，通过 `pull()` 一次只推进一个输出块，并在客户端取消时关闭异步游标；边查边写，不把台账整体载入内存。分页用 `(created_at, id)` 升序键集游标：

```sql
created_at > :cursor_created_at
OR (created_at = :cursor_created_at AND id > :cursor_id)
```

不用 `OFFSET`：导出期间仍有新记录写入，`OFFSET` 分页会漏记录或重复记录。单页步长 `AUDIT_EXPORT_PAGE_SIZE = 500`，命中 `audit_log_realm_created_idx`。

## 序列化

- 列顺序固定为 schema 顺序：`id, realm_id, actor_type, actor_id, action, target, payload_hash, idempotency_key, result, created_at`。
- `target` / `result` 为 JSON 字符串，`created_at` 为 ISO 时间戳。
- CSV 全列加引号并对 `"` 双写；以 `=` `+` `-` `@` 开头的单元格加 `'` 前缀，防止表格软件把 `actor_id` 等自由文本当公式执行。
- 文件名 `aether-audit-<realm-slug>-<iso-stamp>.<ext>`，slug 与时间戳中的非 `[A-Za-z0-9-_]` 字符替换为 `-`。

响应头：`Content-Disposition: attachment`、`Cache-Control: no-store`；JSONL 用 `application/x-ndjson; charset=utf-8`。

## 导出自身可审计

导出在开始流式输出前写入一条 `read` 审计记录：

```ts
target: { kind: 'audit_export', format, actor_type?, action?, from?, to? }
payload_hash: sha256(JSON.stringify(target))
idempotency_key: `audit-export:${randomUUID()}`
```

每次导出用唯一 idempotency key（导出不是幂等重放的写操作，同参数重复导出是**两次**需要各自留痕的取证行为）。该记录写在流开始之前，因此会出现在自己的导出结果里。

## UI

审计页过滤控件旁提供「导出 CSV / JSONL」，链接沿用当前 `actorType` / `action` 过滤条件；导出范围是筛选结果全量，与页面已加载的分页无关。

## Vercel

Route Handler 使用 Web `Request` / `Response` 与 `ReadableStream`，`export const dynamic = 'force-dynamic'`，无新增运行时依赖。

## 不在本次范围

- 时间范围选择器（`from` / `to` 目前只能手工拼 URL）。
- 导出物签名与 Audit Vault 完整性链校验。
- 外部 IdP（OIDC / SAML）与 SCIM 端点。
