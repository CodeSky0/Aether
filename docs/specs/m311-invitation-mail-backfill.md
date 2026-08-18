# Spec: M3.11 — 邀请邮件真实投递与 Realm organization 回填

## 现状与缺口

M3.10 已接通 Better-Auth organization 邀请与 Aether `members` 的 JIT 镜像，但邀请邮件仍只输出 console placeholder；历史 Realm 的 `auth_org_id` 仍可能是占位值 `org-placeholder-*`，无法使用 organization 邀请链路。缺少真实邮件适配层和一次性回填工具会使已存在的 Realm 无法平滑迁移到真实 organization。

## 交付内容

### 邀请邮件

- `@aether/auth` 提供可注入的 `Mailer` / `InvitationMail` 接口。
- 默认 `console` provider 保留开发态 placeholder 日志行为。
- `resend` provider 只使用全局 `fetch` 调用 Resend HTTP API，并对缺少配置、未知 provider 和非 2xx 响应明确报错。
- `createAuth` 的 Better-Auth invitation callback 生成包含 Realm 名称、角色和接受链接的邮件数据。

### Realm organization 回填

- 新增 `@aether/auth` 一次性 `tsx` CLI，默认 dry-run，显式 `--apply` 才写库。
- 通过默认 `--owner-email` 和重复的 `--realm <slug>=<email>` 参数为占位 Realm 指定 owner。
- 只处理 `org-placeholder-*`，按 email 查找已存在的 Better-Auth user，不猜测缺失用户。
- 复用 Realm slug 创建 organization，并在单事务中绑定 Realm、幂等写入 owner membership 和 SHA-256 审计记录。
- 每个 Realm 独立处理，输出 processed / skipped / failed 汇总，支持重复执行。
- CLI 使用同时包含 `@aether/db` 与 `@aether/auth` 表的 Drizzle schema；`tsx` 和 `postgres` 仅作为开发依赖，不进入 Web 构建图。

## 不在范围

- 邀请接受页面和成员管理 UI。
- SMTP、`nodemailer`、`resend` SDK 等运行时依赖。
- 外部 IdP、SSO / SCIM provisioning 端点。
- 自动修改冲突的 Realm slug。
- 将回填脚本作为 Web Server Action、Route Handler 或 Vercel 长驻任务运行。

## 验收标准

- [x] console provider 默认可用且不输出密钥。
- [x] Resend provider 使用全局 `fetch`，校验配置、请求字段和错误脱敏。
- [x] Better-Auth invitation callback 正确生成 `baseURL/invitations/<id>` 接受链接。
- [x] 回填 CLI 默认 dry-run，`--apply` 才写库，参数覆盖优先级可测试。
- [x] 仅处理占位 organization；已绑定 Realm、缺 owner email 或查不到 user 时分类汇总并继续。
- [x] apply 模式复用 organization system action，并在事务中完成 Realm、owner membership 和 SHA-256 审计写入。
- [x] 脚本使用组合认证 / 领域 schema，且不被 Web 构建图引用。
- [x] `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Web production build 通过。
