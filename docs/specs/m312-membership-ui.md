# Spec: M3.12 — 邀请 / 成员管理 UI 与 membership 授权收口

## 现状与缺口

M3.10、M3.11 已提供邀请 Server Action、JIT 镜像与邮件投递，但邀请只能通过代码调用，被邀请者拿到 `baseURL/invitations/<id>` 链接后没有可用页面；Realm 成员与待处理邀请也无从查看。此外 membership 管理动作的授权依赖 `requireEntitlement`，而它在 `AETHER_ENTITLEMENT_ENABLED` 未开启时直接放行，等于「任一已登录用户可管理任意 Realm 成员」。

## 交付内容

### UI

- `/realms/:id/members`：成员列表、待处理邀请列表、邀请表单（owner / admin 可见）。
- `/invitations/:id`：接受邀请页，接受成功后镜像 Aether membership 并回到对应 Realm。
- NavShell 增加成员管理入口；数据加载失败按原因给出可读中文提示（未绑定真实 organization、Better-Auth 未配置、无权限），不回落到 500。

### Server Actions

- 新增 `listRealmMembers`、`revokeRealmInvitation`；`acceptRealmInvitation` 返回 `realmId`。
- 撤销邀请前校验邀请属于该 Realm 绑定的 organization，阻止跨 organization 撤销。

### 授权收口

- 新增 `lib/membership-guard.ts`：`requireRealmRole` 校验 actor 在该 Realm 持有 Realm 级 `active` membership 且角色在允许集合内，读操作允许 owner / admin / member，管理操作仅 owner / admin。
- 该守卫不受 `AETHER_ENTITLEMENT_ENABLED` 影响；`requireEntitlement` 的全局默认关闭语义保持不变。
- 守卫先执行一次 JIT 镜像，Better-Auth organization 成员首次访问仍可通过。

### 回填与邮件加固

- 回填 CLI 复用上一轮失败留下的同名 slug 孤儿 organization，使回填可重试；organization 已被其它 Realm 绑定或缺少目标 owner 时报错而非静默复用。
- `AETHER_MAIL_PROVIDER` 为空串或空白按未设置处理，走 console provider。

## 不在范围

- Better-Auth → Aether membership 的持续对齐（降级 / 移除同步语义待定）。
- 成员角色变更与移除 UI。
- Audit Vault 导出、外部 IdP、SCIM 端点。

## 验收标准

- [x] 成员页展示成员、邀请与邀请表单，失败原因可读。
- [x] `/invitations/:id` 可接受邀请并镜像 membership。
- [x] 所有 membership action 先校验会话，再做角色守卫，且不依赖 entitlement 开关。
- [x] 跨 organization 邀请撤销被拒绝。
- [x] 回填在 organization 已建、Realm 绑定失败后可重跑成功。
- [x] `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Web production build 通过。
