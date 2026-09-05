# Plan: M3.19 — OAuth App Registry

Spec: [m319-oauth-app-registry.md](./m319-oauth-app-registry.md)

## 实施顺序

1. **纯函数层** `packages/@aether/resonance/src/oauth.ts`
   - client_id / client_secret / authorization code / access token 生成
     （`oapp_` / `osec_` / `aoat_` 前缀 + base64url，复用 encoding helpers）
   - PKCE S256 challenge 校验（sha256(verifier) == challenge）
   - scope 目录（`read` / `write`）与解析（空格分隔）
   - redirect_uri 校验（https 限定 + loopback 例外）
   - 导出挂 index.ts
2. **DB schema** `packages/@aether/db/src/schema.ts` + migration 0006
   - `oauth_apps`（client_id 唯一、secret 哈希、redirect_uris jsonb、软删除）
   - `oauth_authorizations`（code 侧 + token 侧同行、token_hash 唯一、
     轮换吊销与查询索引）
3. **协议层** `apps/@aether/web/lib/oauth/protocol.ts`
   - authorize 查询参数 / token 请求体 / 注册输入的 zod schema
   - 错误响应形状（`invalid_grant` / `invalid_client` / `insufficient_scope`）
   - app / authorization 资源映射（snake_case + ISO 时间戳）
4. **服务层** `apps/@aether/web/lib/oauth/service.ts`
   - Server Actions：registerOAuthApp / listOAuthApps / rotateOAuthAppSecret /
     deleteOAuthApp / listMyOAuthAuthorizations / revokeOAuthAuthorization
   - 授权流程：renderAuthorize（校验 + 会话 + 同意页数据）/
     submitAuthorize（批准 / 拒绝 → code + 302）
   - 兑换：exchangeToken（全量校验 + 轮换吊销 + 审计，事务）
5. **鉴权接入** `lib/resonance/auth.ts` 双通道
   - `aeth_` → API Key（不变）；`aoat_` → OAuth token 三重 fail-closed
   - ResolvedApiKey 扩展 kind/appId/scopes；scope 按 method 强制（403）
   - apiKeyActor 区分 `api-key:` / `oauth-app:` 主体
6. **路由与 UI**
   - `app/oauth/authorize/page.tsx`（同意页 + 错误页形态）
   - `app/api/oauth/token/route.ts`（POST 兑换）
   - Integrations 页：OAuthAppsCard（注册/列表/轮换/删除 + 我的授权吊销）
7. **测试**
   - `tests/oauth-core.test.ts`：生成格式、PKCE、scope 解析、redirect_uri 校验
   - `tests/oauth-service.test.ts`：注册（secret 一次性）/ 授权校验矩阵 /
     兑换矩阵（重放/过期/错 secret/PKCE）/ 轮换吊销 / fail-closed
   - `tests/resonance-auth.test.ts` 扩展：aoat_ 双通道、scope 403、API Key 不变
8. **门禁 + 文档**：README（OAuth 流程文档）、docs/README.md（33/34）、
   milestones 勾选。

## 文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `packages/@aether/resonance/src/oauth.ts` |
| 修改 | `packages/@aether/resonance/src/index.ts` |
| 修改 | `packages/@aether/db/src/schema.ts` |
| 新建 | `packages/@aether/db/drizzle/0006_*.sql`（db:generate） |
| 新建 | `apps/@aether/web/lib/oauth/protocol.ts` |
| 新建 | `apps/@aether/web/lib/oauth/service.ts` |
| 修改 | `apps/@aether/web/lib/resonance/auth.ts`（双通道 + scope） |
| 新建 | `apps/@aether/web/app/oauth/authorize/page.tsx` |
| 新建 | `apps/@aether/web/app/api/oauth/token/route.ts` |
| 修改 | `apps/@aether/web/app/realms/[id]/settings/integrations/page.tsx` |
| 新建 | `apps/@aether/web/components/oauth-apps-card.tsx` |
| 新建 | `apps/@aether/web/tests/oauth-core.test.ts` |
| 新建 | `apps/@aether/web/tests/oauth-service.test.ts` |
| 修改 | `apps/@aether/web/tests/resonance-auth.test.ts` |
| 修改 | `README.md` / `docs/README.md` / `docs/roadmap/milestones.md` |
| 新建 | `docs/specs/m319-oauth-app-registry.md` / `m319-plan.md` |

## 风险与对策

- **鉴权层回归**：双通道改造触碰全部 /api/v1 端点的前置——保持
  ResolvedApiKey 形状兼容（新增可选字段），现有 resonance-service 测试
  全绿为准。
- **UI 改动范围**：integrations 页已有 GitHub 卡片，新卡片独立组件，
  不动既有结构。
- **授权页会话**：复用 resolveCurrentActor + requireRealmRole；未登录跳
  登录页（Next redirect，带回跳参数）。
