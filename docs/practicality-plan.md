# Aether 实用化实现方案

> 目标：把所有功能实用化，增加真正实用的功能，对接适应真正的团队开发全过程需求。
>
> 调查基线：2026-09-25 全仓 very thorough 级实现完成度调查。

---

## 一、现状速览

Aether 实现完成度已很高，**不是 demo**：

- **5 个核心范式（Realm / Current / Entity / Thread / Drift）全部真实实现**：DB schema + API / Server Actions + UI + 权限 / 审计全链路打通
- **真实调用 LLM**（Vercel AI SDK 多 provider 动态 import + 流式），非 mock
- **真实 Yjs 协同**（Hocuspocus 权威通道 + Server Actions 降级 + IndexedDB Drift + Reconnect）
- **企业级特性齐全**：Better-Auth + OIDC SSO + SCIM 2.0 + API Key + Webhook Constellation + Audit Vault + Converge Telemetry
- **64 个测试文件**，源码中几乎无 TODO / placeholder / not implemented
- 团队开发全过程（需求 / 设计 / 编码 / 评审 / 测试 / CI / CD / 部署 / 运维）均有对应功能且真实可用

---

## 二、真正的实用性缺口

| # | 缺口 | 现状 | 影响 |
|---|------|------|------|
| 1 | **真实代码库接入** | `current-workspace.tsx:27` 硬编码 4 个文件（`WORKSPACE_FILES`），无 Git / FS 集成 | Current 编辑器不能编辑真实仓库——最大 demo 痕迹 |
| 2 | **Dockerfile / 自托管基线** | 全仓无 Dockerfile | 企业团队无法私有部署 |
| 3 | **PR 评审闭环 UI** | PR↔Manifestation 映射已有，但缺在 Aether 内看 diff / approve / merge 的完整 UI | 评审环节未闭环 |
| 4 | **CI/CD 结果可视化** | CI 在 GitHub Actions，结果未回流 Aether | 运维环节断裂 |
| 5 | **Thread 看板视图** | Thread 有状态机但无看板 UI | 任务流转不直观 |
| 6 | **文档 / 配置不一致** | 已解决：`vercel.json` 移除 Cron，webhook 投递改外部 Cron 触发（Vercel Hobby 仅允许每日 Cron） | 已闭环 |

---

## 三、共同前置

方向 1 / 3 / 4 都依赖以下两个前置，必须先做。

### 前置 A：统一 doc_ref 契约（阻塞 Git 接入 + Docker Node 入口）

**问题**：当前三套约定冲突——

| 来源 | 约定 | 文件 / 行 |
|------|------|-----------|
| editor-host `docRefForRealm` | `realm:<slug>`（整个 realm 一个 Doc，文件是 content Map 的 `code:<path>` key） | `editor-host/src/core/doc.ts:15-17` |
| editor-host 传给 Provider 的 docName | = docRef = `realm:<slug>`（不含 `/`） | `editor-host/src/core/host.ts:59` |
| converge-server Node `parseDocumentName` | 期望 `{realmId}/{docRef}`，按首个 `/` 分割，无 `/` 会抛错 | `converge-server/src/document-name.ts:22-37` |
| converge-server CF `idFromName` | docName 任意字符串作 DO 分片 key，不解析 | `converge-server/cf/index.ts:43-45` |
| web `current-editor.tsx` | `thread:<threadId>` 或 `file:{realmId}:{path}` | `web/components/current-editor.tsx:120` |
| web `current-workspace.tsx` ActivityTrail 解析 | `doc_ref.split(':').slice(2).join(':')` 提取 path（假设 `file:{realmId}:{path}`） | `web/components/current-workspace.tsx:189,405` |

**方案**：统一为 **每文件一个独立 doc_ref = `file:{realmId}:{filePath}`**，documentName = `{realmId}/file:{realmId}:{filePath}`。

- 改 `editor-host/src/core/doc.ts`：`docRefForRealm` → `docRefForFile(realmSlug, filePath)`，`getOrCreateText` 退化为单 `text` key
- 改 `editor-host/src/core/host.ts:42-43,59`：docName 用新约定
- `converge-server/src/document-name.ts` + `extensions/database.ts`：已按 `(realmId, docRef)` 参数化，docRef 换格式即可，逻辑不动
- CF Worker `idFromName` 不解析，自动每文件一个 DO，无需改
- `current-workspace.tsx:189,405` 的 path 解析已假设 `file:{realmId}:{path}`，天然兼容
- **迁移**：旧 `realm:<slug>` doc 的 crdt_updates 需一次性脚本搬到新 doc_ref（或接受历史协同增量丢失，因 Git blob 成为新种子源）

**风险**：中。改的是协同核心命名约定，但有 64 个测试兜底。建议先加 doc_ref 契约的单测。

### 前置 B：installation access token 闭环 + GitHub API 客户端（阻塞 PR 评审 + CI/CD）

**问题**：`fetchInstallationAccessToken` 是孤儿函数，`realm_integrations.encrypted_token / token_expires_at` 预留字段未接线。所有 GitHub 业务 API 调用目前无凭据获取路径。全仓无 octokit，零业务 API 调用。

**方案**：

- 新增 `packages/@aether/resonance/src/github-client.ts`：封装 `getInstallationToken(realmIntegration)` 实现「读 `encrypted_token` 缓存 → 过期用 `fetchInstallationAccessToken` 换发 → AES-GCM 加密写回」闭环，复用现有 `decryptSecret / encryptSecret`
- 新增 `apps/@aether/web/lib/github-api.ts`：基于原生 `fetch`（不引 octokit，保持现有风格）封装 PR / check_run / workflow_run 端点调用，统一鉴权 header 注入
- GitHub App manifest `default_permissions` 补 `checks: 'read'`、`statuses: 'read'`、`actions: 'read'`；`default_events` 补 `check_run` / `check_suite` / `workflow_run` / `pull_request_review` / `pull_request_review_comment` + `pull_request` 的 synchronize / closed / edited / ready_for_review action

**风险**：低。纯增量，不动现有 Issue↔Thread 链路。token 加密复用已验证的 AES-GCM 工具。

---

## 四、方向 1：真实 Git 仓库接入（完整读写 + 提交 / 分支）

**目标**：Realm 绑定 Git 远端，编辑器展示真实文件树，可读可编辑可提交可切分支。取代 `WORKSPACE_FILES` 硬编码 4 文件。

### Schema 改动（`packages/@aether/db/src/schema.ts`）

- `realms` 表加 `git_remote_url text`、`git_default_branch text`、`git_auth_strategy text`（`installation` | `ssh` | `none`）
- 复用现有 `realm_integrations`（已有 `repo_full_name` + `installation_id`）做 GitHub 仓库绑定；非 GitHub 仓库用 `git_remote_url` + SSH key
- 新增 `git_branches` 表：`realm_id`、`name`、`head_sha`、`is_checked_out`、`updated_at`（分支元数据缓存）
- 新增 `git_worktree_state` 表（可选）：`realm_id`、`branch`、`path`、`sha`、`dirty boolean`（跟踪 Yjs 编辑未提交的脏文件）

### 后端（新增 `apps/@aether/web/lib/git/`）

- `clone.ts`：Realm 创建 / 配置时克隆远端到服务端 worktree（用 `simple-git`，依赖系统 git）
- `tree.ts`：`listGitTree(realmId, branch)` 返回文件树（`git ls-tree`），取代 `WORKSPACE_FILES`
- `blob.ts`：`readGitBlob(realmId, branch, path)` 读文件内容作为 Yjs Doc 首次种子
- `commit.ts`：`commitAndPush(realmId, branch, paths, message, actor)` 把 Yjs Doc 全量快照写回 worktree → `git add` → `git commit` → `git push`
- `branch.ts`：`createBranch / checkout / listBranches`
- **种子机制**：converge-server `onLoadDocument` 时若该 doc_ref 无 crdt_updates 历史，从 Git blob 注入初始内容（新增 `extensions/git-seed.ts`，调 web 的 `readGitBlob` API）；或 editor-host 首次加载时若 Y.Text 空则拉 blob

### UI 改动

- `current-workspace.tsx:27-32`：删 `WORKSPACE_FILES`，改从 `listGitTree` Server Action 拉文件树，渲染真实树（支持目录折叠）
- 新增 `components/git-branch-selector.tsx`：顶栏分支切换 / 创建
- 新增 `components/git-commit-bar.tsx`：底部提交按钮（脏文件列表 + commit message + push）
- `realms/[id]/settings/` 新增 `git/page.tsx`：配置 Git 远端 / 绑定 GitHub repo

### 分步

- **1a 只读文件树**（低风险）：克隆 + 文件树浏览 + Git blob 种子 + 编辑走 Yjs 不回写 Git。立即提升实用性。
- **1b 提交 / 分支**（高风险）：commit + push 到当前分支 + 创建 / 切换分支，但不做 merge / rebase 冲突解决（交给 GitHub PR 流程）。

### 风险

高。服务端 Git worktree 多 Realm 并发隔离、push 鉴权（SSH key 管理 / installation token 推送）、Yjs↔Git 冲突合并是难点。**前置 A 必须先完成**。

---

## 五、方向 2：Dockerfile / 自托管基线

**目标**：三个 app + postgres + redis 的 docker-compose，企业可私有部署。

### 改动

- `apps/@aether/web/Dockerfile`：`node:22-alpine`，corepack 启用 pnpm 11，COPY 全仓（monorepo），`pnpm install --frozen-lockfile`，`turbo build --filter=@aether/web`，运行 `next start`。需在 `next.config.ts` 加 `output: 'standalone'` 做瘦镜像
- `apps/@aether/editor-host/Dockerfile`：构建阶段 `node:22-alpine` + `AETHER_EDITOR_HOST_BASE=/ vite build`，运行阶段 `nginx:alpine` 托管 `dist/` 静态产物
- `apps/@aether/converge-server/Dockerfile`：`node:22-alpine`，`turbo build --filter=@aether/converge-server`，运行 `node dist/index.js`（Node 入口，非 CF）
- 根 `docker-compose.yml`：postgres:16-alpine + redis:7-alpine（可选）+ 三 app，依赖图 + 健康检查 + env 注入
- 迁移：entrypoint 或 init 容器跑 `pnpm --filter @aether/db db:migrate`（不在构建期连 DB）
- web cron：用 `supercronic` 或 compose 外部 cron 调 `/api/webhooks/dispatch`

### 镜像与端口

| 服务 | 镜像基础 | 暴露端口 | 依赖服务 | 构建命令（容器内） |
|------|----------|----------|----------|---------------------|
| web | `node:22-alpine` | 3000 | postgres | `turbo build --filter=@aether/web`，运行 `next start` |
| editor-host | `node:22-alpine`（构建）+ nginx（运行） | 80 | 无 | `AETHER_EDITOR_HOST_BASE=/ vite build` → `dist/` 静态 |
| converge-server | `node:22-alpine` | 1234 | postgres（必需）、redis（可选） | `tsc -p tsconfig.build.json` → `dist/index.js` |
| postgres | `postgres:16-alpine` | 5432 | — | 跑 `db:migrate` 初始化 |
| redis（可选） | `redis:7-alpine` | 6379 | — | 仅 converge-server 多实例时 |

### docker-compose 依赖图

```
postgres (5432) ──┬── web (3000) ── [NEXT_PUBLIC_EDITOR_HOST_URL→editor-host]
                  └── converge-server (1234) ── [可选 redis (6379)]
editor-host (80) ── [NEXT_PUBLIC_CONVERGE_SERVER_URL→ws://converge-server:1234/api/ws]
```

### 风险

低-中。纯增量文件。注意 **前置 A**——Node converge-server 入口当前因 doc_ref 契约不一致会抛错，Docker 自托管走 Node 入口必须先修前置 A。`.dockerignore` 已就绪。

---

## 六、方向 3：PR 评审闭环 UI

**目标**：在 Aether 内看 PR diff、行内评论、approve / request changes / merge，不跳转 GitHub。

### Schema 改动

- 新增 `pull_requests` 表：`id`、`realm_id`、`thread_id`（关联）、`number`、`repo_full_name`、`head_sha`、`base_sha`、`state`（open / closed / merged / draft）、`title`、`author`、`updated_at`
- 新增 `pr_reviews` 表：`id`、`pr_id`、`review_id`(gh)、`state`（approved / changes_requested / commented / dismissed）、`body`、`reviewer`、`submitted_at`
- 新增 `pr_review_comments` 表：`id`、`pr_id`、`review_id`、`path`、`line`、`side`、`in_reply_to_id`、`body`、`author`、`created_at`
- 可选 `pr_diff_cache` 表：`pr_id`、`head_sha`、`diff jsonb`（缓存避免重复拉）

### 后端

- `lib/github-api.ts`（前置 B）：`getPR / getPRFiles / getPRReviews / getPRComments / createReview / createReviewComment / mergePR`
- `lib/github-webhook.ts`：补 `pull_request` 的 synchronize / closed / ready_for_review action；新增 `pull_request_review`、`pull_request_review_comment` 事件处理 → 写 `pr_reviews` / `pr_review_comments`
- 新增 `app/api/realms/[realmId]/prs/[number]/route.ts`：聚合 PR + diff + reviews + comments
- 新增 Server Actions：`approvePR / requestChanges / mergePR / addPRComment`

### UI 改动

- 新增 `components/pr-diff-viewer.tsx`：文件树 + diff hunks + 行级评论锚点（结构化渲染，非 iframe——GitHub PR 页禁止 iframe 嵌入）
- 新增 `components/pr-review-panel.tsx`：review 列表 + approve / request changes / merge 按钮
- 新增 `app/realms/[id]/prs/[number]/page.tsx`：PR 评审页
- `thread-dialogue.tsx`：当 thread 关联 PR 时，"查看预览"按钮改为打开 PR diff viewer 而非 manifestation iframe

### 风险

中-高。diff 渲染、行内评论锚点（GitHub 的 line / side / position 语义复杂）、merge 冲突处理。**依赖前置 B**。

---

## 七、方向 4：CI/CD 结果可视化

**目标**：GitHub Actions / check_run 结果回流 Aether，在 Realm / PR 内可见。

### Schema 改动

- 新增 `ci_runs` 表：`id`、`realm_id`、`repo_full_name`、`head_sha`、`name`、`status`（queued / in_progress / completed）、`conclusion`（success / failure / neutral / cancelled / timed_out）、`started_at`、`completed_at`、`html_url`、`details_url`、`pr_number`（可空关联）
- 可选 `ci_jobs` 表：job 级明细（steps、logs_url）

### 后端

- `lib/github-webhook.ts`：新增 `check_run` / `check_suite` / `workflow_run` 事件处理 → upsert `ci_runs`
- `lib/github-api.ts`（前置 B）：`listCheckRunsForRef / getWorkflowRunLogs`
- 新增 Server Action：`listCiRuns(realmId, prNumber?)`

### UI 改动

- 新增 `components/ci-status-badge.tsx`：在 Thread / PR 旁显示 CI 状态（pending / success / failure）
- 新增 `components/ci-runs-panel.tsx`：check runs 列表（name / status / conclusion / 耗时 / 可展开日志）
- PR 评审页聚合该 PR head_sha 的所有 check 结果
- `realms/[id]/` 新增 `ci/page.tsx`：Realm 级 CI 总览

### 风险

中。日志解 zip + 流式渲染较繁。**依赖前置 B**。

---

## 八、方向 5：Thread 看板视图

**目标**：Thread 状态机已有（open / in_review / resolved / archived），补看板 UI 让任务流转直观。

### 改动（无 schema 改动，纯 UI + 复用现有 `lib/threads.ts`）

- 新增 `app/realms/[id]/board/page.tsx`：四列看板（Open / In Review / Resolved / Archived），拖拽切换状态
- 新增 `components/thread-board.tsx` + `components/thread-card.tsx`
- 新增 Server Action：`moveThreadStatus(threadId, newStatus)`（调现有 `corePatchThread` 状态机）
- `nav-shell.tsx`：导航加"看板"入口

### 风险

低。纯 UI，复用已验证的状态机。独立，可先做。

---

## 九、方向 6：文档 / 配置不一致修复

### 改动

- `apps/@aether/web/vercel.json` Cron 已移除，webhook 投递改外部 Cron 触发（Vercel Hobby 仅允许每日 Cron）——README / deployment.md 已同步
- `docs/roadmap/milestones.md`：M3.20 / M3.21 已落地但未勾选，补勾 + 同步状态文案
- `apps/@aether/web/app/page.tsx:113` 首页状态文案同步

### 风险

极低。

---

## 十、建议实施顺序

| 序 | 项 | 依赖 | 风险 |
|---|---|------|------|
| 1 | 方向 6 文档不一致 | 无 | 极低 |
| 2 | 前置 A doc_ref 契约统一 | 无 | 中 |
| 3 | 方向 5 Thread 看板 | 无 | 低 |
| 4 | 前置 B GitHub token 闭环 + API 客户端 | 无 | 低 |
| 5 | 方向 1a Git 只读文件树 | 前置 A | 中 |
| 6 | 方向 1b Git 提交 / 分支 | 前置 A + 1a | 高 |
| 7 | 方向 3 PR 评审闭环 | 前置 B | 中-高 |
| 8 | 方向 4 CI/CD 可视化 | 前置 B | 中 |
| 9 | 方向 2 Dockerfile | 前置 A | 低-中 |

每个方向完成后跑 `lint` / `typecheck` / `test` 验证再进下一个。

---

## 十一、风险矩阵

| 风险 | 涉及方向 | 缓解 |
|------|----------|------|
| doc_ref 契约变更破坏现有协同 | 前置 A、方向 1、方向 2 | 先加 doc_ref 契约单测；旧 crdt_updates 一次性迁移脚本 |
| 服务端 Git worktree 多 Realm 并发隔离 | 方向 1 | 每 Realm 独立 worktree 路径；文件锁 |
| push 鉴权（SSH key / installation token） | 方向 1 | GitHub 仓库走 installation token；裸 Git 走 SSH key 加密存储 |
| Yjs↔Git 冲突合并 | 方向 1b | 不做本地 merge，提交后走 GitHub PR 流程解决冲突 |
| GitHub PR diff 行内评论锚点语义复杂 | 方向 3 | 严格按 GitHub line / side / position 规范；先支持单行评论再扩展 multi-line |
| installation token 缓存竞态 | 前置 B | 用 DB 行锁 + 幂等键防并发换发 |
| Docker 构建期不应连生产 DB | 方向 2 | 迁移移到 entrypoint / init 容器 |
| Node converge-server 入口 doc_ref 抛错 | 方向 2 | 前置 A 先修 |
