# Plan: M3.14 — SSO（OIDC）接入与登录 UI

## 步骤

1. **`@aether/auth`：OIDC 配置注入**
   - 新建 `src/oidc.ts`：`OidcProviderConfig` 类型 + `toGenericOAuthConfig(config, baseURL)` 纯映射（显式 `redirectURI`、默认 scopes `['openid','email','profile']`、`pkce` 透传）。
   - `src/instance.ts`：`CreateAuthOptions` 增加 `oauthProviders`；非空时追加 `genericOAuth` 插件；`index.ts` 导出。
   - 新建 `tests/oidc.test.ts` 覆盖映射函数；`instance.test.ts` 补「传 provider 不抛错 / 不传时行为不变」。
2. **Web：环境变量解析**
   - `lib/auth.ts`：新增纯函数 `resolveOidcProviderConfig(env)`（部分配置抛可读错误、`PKCE` 仅字面量 `true`），`createWebAuth` 读取并传入 `oauthProviders`；导出 `getWebOidcProvider()` 供登录页判断渲染。
   - 新建 `tests/oidc-config.test.ts` 覆盖三种配置态。
3. **登录页面**
   - 新建 `app/login/page.tsx`（server：auth 未配置 → 可读提示）。
   - 新建 `components/auth-forms.tsx`（client：登录/注册切换、错误显示、OIDC 按钮）。
4. **NavShell 用户态**
   - 新建 `components/user-menu.tsx`（client：get-session → email + 登出 / 登录链接，失败按未登录）。
   - `components/nav-shell.tsx` header 右侧替换「首页」区为 `UserMenu`。
5. **文档同步**
   - README 环境变量表（`AETHER_OIDC_*`）、docs 索引、milestones SSO/SCIM 备注。
6. **质量检查与交付**
   - `pnpm typecheck` / `pnpm lint` / `pnpm test` / Web production build 全绿。
   - 在 `converge/auth/sso-oidc` 分支提交推送，不创建 PR。

## 文件变更清单

| 操作 | 路径 |
|------|------|
| 新建 | `packages/@aether/auth/src/oidc.ts` |
| 新建 | `packages/@aether/auth/tests/oidc.test.ts` |
| 修改 | `packages/@aether/auth/src/instance.ts` |
| 修改 | `packages/@aether/auth/src/index.ts` |
| 修改 | `packages/@aether/auth/tests/instance.test.ts` |
| 修改 | `apps/@aether/web/lib/auth.ts` |
| 新建 | `apps/@aether/web/tests/oidc-config.test.ts` |
| 新建 | `apps/@aether/web/app/login/page.tsx` |
| 新建 | `apps/@aether/web/components/auth-forms.tsx` |
| 新建 | `apps/@aether/web/components/user-menu.tsx` |
| 修改 | `apps/@aether/web/components/nav-shell.tsx` |
| 修改 | `README.md` |
| 修改 | `docs/README.md` |
| 修改 | `docs/roadmap/milestones.md` |
| 新建 | `docs/specs/m314-sso-oidc.md` |
| 新建 | `docs/specs/m314-plan.md` |

## 风险与注意事项

- `options` 透传层 Omit 了 `plugins`，OIDC 插件必须由 `createAuth` 自己组装，不允许绕开透传限制直接让下游塞插件。
- `genericOAuth` 的类型从 better-auth 的 `generic-oauth` 子路径导入仅限 `@aether/auth` 包内部使用；对 Web 只暴露自声明的 `OidcProviderConfig`。
- 回调地址是 `${BETTER_AUTH_URL}/api/auth/oauth2/callback/${providerId}`，README 需写明 IdP 侧要配置的 redirect URI。
- 部分配置（有 discovery 无 clientId 或反之）必须 fail-fast，不允许静默忽略半个 OIDC 配置。
- 登录/注册/OIDC 端点全部走 REST，不引入 `better-auth/client`；错误消息展示 Better-Auth 响应的 `message` / `code`。
- `UserMenu` 在 auth 未配置时（`/api/auth/*` 500）静默按未登录处理，不产生控制台噪声级报错。
- M3.10 JIT 镜像已保证 OIDC 用户进 organization 后自动获得 membership，本任务不重复实现。
