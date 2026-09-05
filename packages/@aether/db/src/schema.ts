// @aether/db · Drizzle schema
// 表结构与字段对齐 docs/roadmap/data-model.md，命名遵循 Aether 术语体系。
// schema 是 @aether/types 领域类型的运行期实现映射；类型保持同构。
import {
  customType,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  uuid,
  bigserial,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
// bytea：drizzle 0.45 的 pg-core 未内置二进制列，用 customType 声明。
// data 侧为 Uint8Array（与 yjs 增量字节序一致），driver 侧交给连接驱动编码。
const bytea = customType<{
  data: Uint8Array
  driverData: Buffer
}>({
  dataType() {
    return 'bytea'
  },
  toDriver(value: Uint8Array) {
    return Buffer.from(value)
  },
})
export const actorTypeEnum = pgEnum('actor_type', ['human', 'entity'])
export const memberStatusEnum = pgEnum('member_status', [
  'active',
  'suspended',
  'invited',
])
export const entityStatusEnum = pgEnum('entity_status', [
  'active',
  'idle',
  'waiting',
  'suspended',
])
export const threadStatusEnum = pgEnum('thread_status', [
  'open',
  'in_review',
  'resolved',
  'archived',
])
export const connectionStateEnum = pgEnum('connection_state', [
  'active',
  'drift',
  'converging',
])
export const auditActionEnum = pgEnum('audit_action', [
  'read',
  'write',
  'permission_change',
  'converse',
  'execute',
])
export const dialogueRoleEnum = pgEnum('dialogue_role', [
  'user',
  'assistant',
  'system',
])
// ---- realms（领域：隔离边界与权限树根）----
export const realms = pgTable(
  'realms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    auth_org_id: text('auth_org_id').notNull(),
    schema_namespace: text('schema_namespace').notNull(),
    residency: text('residency').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 软删除：非空即视为已删除；查询一律过滤 deleted_at IS NULL
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('realms_slug_uniq').on(t.slug),
    // 高频查询优化：Dashboard/列表按创建时间排序
    index('realms_created_idx').on(t.created_at),
  ],
)
// ---- projects（Realm 二级节点）----
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    default_branch: text('default_branch').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('projects_realm_slug_idx').on(t.realm_id, t.slug),
  ],
)
// ---- members（Realm 三级节点，人类与 Entity 双主体）----
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    project_id: uuid('project_id').references(() => projects.id),
    actor_type: actorTypeEnum('actor_type').notNull(),
    // actor_id 支持 Entity UUID 或 Better-Auth auth identity。
    actor_id: text('actor_id').notNull(),
    role: text('role').notNull(),
    entitlements: jsonb('entitlements').notNull().default({}),
    status: memberStatusEnum('status').notNull().default('active'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('members_actor_idx').on(t.realm_id, t.actor_type, t.actor_id),
    uniqueIndex('members_realm_actor_uniq')
      .on(t.realm_id, t.actor_type, t.actor_id)
      .where(sql`${t.project_id} IS NULL`),
    uniqueIndex('members_project_actor_uniq')
      .on(t.realm_id, t.project_id, t.actor_type, t.actor_id)
      .where(sql`${t.project_id} IS NOT NULL`),
    // 高频查询优化：按项目 + 角色筛选成员
    index('members_project_role_idx').on(t.project_id, t.role),
    // 按状态筛选成员
    index('members_status_idx').on(t.status),
  ],
)
// ---- entities（实体：AI 一等公民档案）----
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    auth_identity_id: text('auth_identity_id').notNull(),
    display_name: text('display_name').notNull(),
    capability_manifesto: jsonb('capability_manifesto').notNull().default({}),
    status: entityStatusEnum('status').notNull().default('idle'),
    memory_ref: jsonb('memory_ref').notNull().default({}),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('entities_auth_identity_idx').on(t.auth_identity_id),
    // 高频查询优化：Realm 面板与活跃计数按 realm_id 过滤/分组
    index('entities_realm_idx').on(t.realm_id),
  ],
)
// ---- threads（线程：Context-Bound 叙事单元）----
export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    project_id: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    status: threadStatusEnum('status').notNull().default('open'),
    code_anchor: jsonb('code_anchor').notNull().default({}),
    manifestation_url: text('manifestation_url'),
    dialogue_ref: uuid('dialogue_ref'),
    resolution_contract: jsonb('resolution_contract'),
    parent_thread_id: uuid('parent_thread_id').references(
      (): AnyPgColumn => threads.id,
    ),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 软删除：非空即视为已删除；查询一律过滤 deleted_at IS NULL
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('threads_realm_created_idx').on(t.realm_id, t.created_at),
    // 高频查询优化：软删除过滤后的活跃线程列表
    index('threads_realm_alive_idx')
      .on(t.realm_id, t.created_at)
      .where(sql`${t.deleted_at} IS NULL`),
    // 高频查询优化：按项目 + 状态筛选线程
    index('threads_project_status_idx').on(t.project_id, t.status),
    // 父子线程关系查询优化
    index('threads_parent_idx').on(t.parent_thread_id),
  ],
)
// ---- currents（当前态：Yjs 连接实例与 Presence 状态流）----
export const currents = pgTable(
  'currents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    doc_ref: text('doc_ref').notNull(),
    presence_snapshot: jsonb('presence_snapshot').notNull().default({}),
    connection_state: connectionStateEnum('connection_state')
      .notNull()
      .default('active'),
    last_converge_at: timestamp('last_converge_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('currents_doc_ref_idx').on(t.doc_ref),
    // 高频查询优化：Presence 心跳/轮询按 (realm_id, doc_ref) 定位
    index('currents_realm_doc_idx').on(t.realm_id, t.doc_ref),
  ],
)
// ---- crdt_updates（CRDT 更新日志：Current 增量落库，仅追加）----
export const crdtUpdates = pgTable(
  'crdt_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    doc_ref: text('doc_ref').notNull(),
    // bigserial 是表级共享序列，per-doc_ref 存在空洞但仍保证全局单调递增；
    // 重放时按 (doc_ref, seq) 排序即可，空洞不影响正确性。
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    payload: bytea('payload').notNull(),
    actor_type: actorTypeEnum('actor_type').notNull(),
    // actor_id 支持 Entity UUID、auth identity 或系统客户端名（web-client / hocuspocus-server），
    // 不能约束为 uuid 类型，否则非 UUID 占位 actor 落库时报错。
    actor_id: text('actor_id').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('crdt_updates_doc_seq_uniq').on(t.doc_ref, t.seq),
    uniqueIndex('crdt_updates_doc_idem_uniq').on(t.doc_ref, t.idempotency_key),
    index('crdt_updates_realm_doc_seq_idx').on(t.realm_id, t.doc_ref, t.seq),
  ],
)
// ---- audit_log（审计轨迹：人类与 Entity 行为统一入账）----
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    actor_type: actorTypeEnum('actor_type').notNull(),
    // actor_id 支持 Entity UUID 或 auth identity；constraint 同 crdt_updates（text）
    actor_id: text('actor_id').notNull(),
    action: auditActionEnum('action').notNull(),
    target: jsonb('target').notNull().default({}),
    payload_hash: text('payload_hash').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    result: jsonb('result').notNull().default({}),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('audit_log_idempotency_idx').on(t.idempotency_key),
    index('audit_log_realm_created_idx').on(t.realm_id, t.created_at),
    // 高频查询优化：按 Actor + 动作筛选审计日志
    index('audit_log_actor_action_idx').on(t.actor_type, t.actor_id, t.action),
    // 按时间范围查询优化
    index('audit_log_action_created_idx').on(t.action, t.created_at),
  ],
)
// ---- api_keys（Resonance 预备：外部插件/工具访问 Realm 的凭据）----
// 明文密钥仅生成时返回一次；库内只存 sha256 哈希与展示前缀。
// 吊销走软删除（revoked_at），保留审计线索。
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    // 展示名（如 "VS Code 插件"）
    name: text('name').notNull(),
    // 明文前 8 字符，用于列表识别（如 aeth_9f2K…）
    key_prefix: text('key_prefix').notNull(),
    // sha256(明文) 十六进制
    key_hash: text('key_hash').notNull(),
    created_by: text('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    // 软吊销：非空即失效；查询一律过滤 revoked_at IS NULL
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('api_keys_hash_uniq').on(t.key_hash),
    index('api_keys_realm_idx').on(t.realm_id),
    index('api_keys_realm_alive_idx')
      .on(t.realm_id)
      .where(sql`${t.revoked_at} IS NULL`),
  ],
)
// ---- dialogue_messages（对话消息：Thread 内嵌的 Entity 对话历史）----
// threads.dialogue_ref 指向 dialogue_id，将一组对话消息绑定到 Thread。
// 每条消息记录 actor（人/Entity）、role（user/assistant/system）与内容，
// 形成可引用的决策记录（Dialogue Forging）。
export const dialogueMessages = pgTable(
  'dialogue_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    // 对话分组标识；threads.dialogue_ref 指向此字段
    dialogue_id: uuid('dialogue_id').notNull(),
    // 对话内单调递增序号，保证消息顺序
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    actor_type: actorTypeEnum('actor_type').notNull(),
    // actor_id 支持 Entity UUID 或 auth identity；constraint 同 crdt_updates（text）
    actor_id: text('actor_id').notNull(),
    role: dialogueRoleEnum('role').notNull(),
    content: text('content').notNull(),
    // 扩展元数据：工具调用、引用、附件引用等
    metadata: jsonb('metadata').notNull().default({}),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('dialogue_messages_dialogue_seq_uniq').on(
      t.dialogue_id,
      t.seq,
    ),
    index('dialogue_messages_realm_dialogue_idx').on(
      t.realm_id,
      t.dialogue_id,
    ),
  ],
)
// ---- realm_integrations（Resonance：Realm 与外部源的双向共振连接）----
// 一条记录 = 一个 Realm 与一个外部 provider（GitHub/GitLab/Linear…）的一次安装。
// GitHub App 模型下 installation_id 由 OAuth 回调写入；installation access token
// 是 1 小时短时凭据，加密缓存于 encrypted_token，过期后用 App JWT 实时换发。
// 明文密钥绝不入库；App private key 只存环境变量。软删除走 deleted_at。
export const integrationProviderEnum = pgEnum('integration_provider', [
  'github',
  'gitlab',
  'linear',
])
export const integrationStatusEnum = pgEnum('integration_status', [
  'active',
  'disconnected',
  'error',
])
export const realmIntegrations = pgTable(
  'realm_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    // provider 机器可读；新增 provider 扩展 enum 即可。
    provider: integrationProviderEnum('provider').notNull(),
    // GitHub App installation id（数字字符串）；非秘密，但落库便于 webhook 反查。
    installation_id: text('installation_id').notNull(),
    // 可选绑定单个 repo（owner/name）；空表示 installation 下全部 repo 共振。
    repo_full_name: text('repo_full_name'),
    // provider 特定配置：同步开关、Issue↔Thread 映射策略、webhook 签名密钥哈希等。
    config: jsonb('config').notNull().default({}),
    // AES-GCM 加密的 installation access token（base64(payload+iv+tag)）；可空=未缓存。
    encrypted_token: text('encrypted_token'),
    token_expires_at: timestamp('token_expires_at', {
      withTimezone: true,
    }),
    status: integrationStatusEnum('status').notNull().default('active'),
    // 创建者 Better-Auth user id；审计与权限归因。
    created_by: text('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 软删除：非空即视为已断开；查询一律过滤 deleted_at IS NULL
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // 一个 Realm 每个 provider 至多一条活跃连接
    uniqueIndex('realm_integrations_realm_provider_uniq')
      .on(t.realm_id, t.provider)
      .where(sql`${t.deleted_at} IS NULL`),
    index('realm_integrations_realm_idx').on(t.realm_id),
    // webhook 回调按 (provider, installation_id) 反查 Realm
    index('realm_integrations_provider_install_idx').on(
      t.provider,
      t.installation_id,
    ),
    index('realm_integrations_realm_alive_idx')
      .on(t.realm_id)
      .where(sql`${t.deleted_at} IS NULL`),
  ],
)
// ---- webhook_subscriptions（Webhook Constellation：出站事件订阅）----
// 一条记录 = 一个 Realm 的事件回调端点订阅。签名密钥明文绝不入库：
// AES-GCM 加密存 encrypted_secret（密钥 AETHER_INTEGRATION_ENCRYPTION_KEY），
// 明文 whsec_ 仅创建响应返回一次；secret_prefix 供列表识别。
// events 为事件类型数组（jsonb），['*'] 通配全部；目录见 @aether/resonance webhooks.ts。
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  // 待投递（含退避等待）；next_attempt_at 到期才可被扫描领取
  'pending',
  // 2xx 投递成功
  'succeeded',
  // 达到重试上限（MAX_WEBHOOK_ATTEMPTS）或不可恢复错误
  'exhausted',
  // 订阅已删除，剩余投递作废
  'canceled',
])
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    // 展示名（如 "CI 通知"）
    name: text('name').notNull(),
    // 回调端点；仅接受 https（zod 层校验），杜绝明文回流出站
    url: text('url').notNull(),
    // 事件类型选择数组；['*'] 通配全部
    events: jsonb('events').notNull(),
    // AES-GCM 加密的签名密钥 base64(iv‖ct‖tag)
    encrypted_secret: text('encrypted_secret').notNull(),
    // 明文前 12 字符（whsec_9f2K…），列表识别用
    secret_prefix: text('secret_prefix').notNull(),
    // 创建者 Better-Auth user id（API Key 场景取密钥创建者）；审计归因
    created_by: text('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 软删除：非空即失效；查询一律过滤 deleted_at IS NULL
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('webhook_subscriptions_realm_idx').on(t.realm_id),
    index('webhook_subscriptions_realm_alive_idx')
      .on(t.realm_id)
      .where(sql`${t.deleted_at} IS NULL`),
  ],
)
// ---- webhook_deliveries（事务性 outbox：与业务变更同事务入队，Cron 扫描投递）----
// 业务回滚则投递行一并回滚（不产生幻影事件）；投递语义 at-least-once，
// 接收方按 x-aether-delivery（delivery id）幂等去重。
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscription_id: uuid('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id),
    // 冗余 realm_id：隔离查询与统计免 join
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    event_type: text('event_type').notNull(),
    // 事件信封 { type, created_at, realm: {id, slug}, data }
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    // 下次可投递时间；退避调度由该列驱动
    next_attempt_at: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_response_status: integer('last_response_status'),
    last_error: text('last_error'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    // 扫描队列：status + 到期时间
    index('webhook_deliveries_queue_idx').on(t.status, t.next_attempt_at),
    // 订阅方投递历史查询
    index('webhook_deliveries_subscription_idx').on(t.subscription_id, t.created_at),
    index('webhook_deliveries_realm_idx').on(t.realm_id),
  ],
)
// ---- oauth_apps（OAuth App Registry：第三方应用注册，Realm 绑定）----
// App 归属 Realm（owner/admin 注册管理）；软删除后全部授权与 token 失效。
export const oauthApps = pgTable(
  'oauth_apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    // 公开客户端标识（oapp_<base64url>，生成于 @aether/resonance/oauth）
    client_id: text('client_id').notNull(),
    // 展示名（如 "CI 通知机器人"）
    name: text('name').notNull(),
    // sha256(client_secret) 十六进制；明文 osec_… 仅注册 / 轮换时返回一次
    client_secret_hash: text('client_secret_hash').notNull(),
    // 明文前 12 字符（osec_9f2K…），列表识别用
    client_secret_prefix: text('client_secret_prefix').notNull(),
    // 回调 URI 白名单（字符串数组，精确匹配；https 限定，loopback 例外）
    redirect_uris: jsonb('redirect_uris').$type<string[]>().notNull(),
    // 注册者 Better-Auth user id；审计归因
    created_by: text('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 软删除：非空即失效（授权与 token 一并失效）；查询过滤 deleted_at IS NULL
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('oauth_apps_client_id_uniq').on(t.client_id),
    index('oauth_apps_realm_idx').on(t.realm_id),
    index('oauth_apps_realm_alive_idx')
      .on(t.realm_id)
      .where(sql`${t.deleted_at} IS NULL`),
  ],
)
// ---- oauth_authorizations（一次授权 = 一行：code 与 access token 同行）----
// code 一次性（exchanged_at）+ 10 分钟过期；token 哈希入库（明文仅兑换时返回）。
// 同一 (app, user, realm) 重新授权兑换时轮换：旧 token 自动吊销。
export const oauthAuthorizations = pgTable(
  'oauth_authorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    app_id: uuid('app_id')
      .notNull()
      .references(() => oauthApps.id),
    realm_id: uuid('realm_id')
      .notNull()
      .references(() => realms.id),
    // 授权用户 Better-Auth user id；token 权限 = 该用户的 Realm membership
    user_id: text('user_id').notNull(),
    // 授权 scope 数组（["read"] / ["read","write"]）
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    // authorize 时实际使用的回调 URI（兑换时必须精确一致）
    redirect_uri: text('redirect_uri').notNull(),
    // ---- authorization code 侧（sha256 哈希，明文不落库）----
    code_hash: text('code_hash').notNull(),
    code_expires_at: timestamp('code_expires_at', { withTimezone: true })
      .notNull(),
    // PKCE S256（可选：authorize 带 challenge 则兑换必须带 verifier）
    code_challenge: text('code_challenge'),
    code_challenge_method: text('code_challenge_method'),
    // 一次性标记：非空即已兑换，拒绝重放
    exchanged_at: timestamp('exchanged_at', { withTimezone: true }),
    // ---- access token 侧（兑换后填充；sha256 哈希，明文仅返回一次）----
    token_hash: text('token_hash'),
    token_prefix: text('token_prefix'),
    token_issued_at: timestamp('token_issued_at', { withTimezone: true }),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    // 吊销（用户撤销 / 轮换收敛）；非空即失效
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_authorizations_token_hash_uniq').on(t.token_hash),
    // Bearer token 解析：哈希唯一索引查找（同 API Key，杜绝时序侧信道）
    index('oauth_authorizations_app_user_idx').on(t.app_id, t.user_id, t.revoked_at),
    index('oauth_authorizations_user_idx').on(t.user_id, t.revoked_at),
  ],
)
