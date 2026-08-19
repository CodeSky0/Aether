// @aether/auth · Better-Auth 实例工厂
// 封装 drizzle adapter + organization 插件接入，统一注入 Realm Tree 权限模型。
// 下游禁止直接依赖 better-auth，一律经本包创建实例。
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { toNextJsHandler } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { realmAccessControl, realmRoles } from './permissions.js'
import { betterAuthSchema } from './schema.js'
import { resolveMailer, type Mailer } from './mailer.js'
import { toGenericOAuthConfig, type OidcProviderConfig } from './oidc.js'
export interface CreateAuthOptions {
  /** 已配置 schema 的 Drizzle pg 实例（含 @aether/auth schema 与 @aether/db schema）。 */
  db: Parameters<typeof drizzleAdapter>[0]
  baseURL: string
  secret?: string
  trustedOrigins?: string[]
  mailer?: Mailer
  /** OIDC provider 列表；非空时注册 genericOAuth 插件。 */
  oauthProviders?: readonly OidcProviderConfig[]
  /** 透传给 betterAuth 的额外选项（如 emailAndPassword、socialProviders）。 */
  options?: Omit<BetterAuthOptions, 'database' | 'baseURL' | 'secret' | 'trustedOrigins' | 'plugins'>
}
export function createAuth(options: CreateAuthOptions) {
  const {
    db,
    baseURL,
    secret,
    trustedOrigins,
    mailer,
    oauthProviders,
    options: extra,
  } = options
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: betterAuthSchema,
    }),
    baseURL,
    secret,
    trustedOrigins,
    plugins: [
      organization({
        ac: realmAccessControl,
        roles: realmRoles,
        allowUserToCreateOrganization: false,
        creatorRole: 'owner',
        sendInvitationEmail: async (data) => {
          const invitationMailer = mailer ?? resolveMailer()
          await invitationMailer.sendInvitation({
            to: data.email,
            realmName: data.organization.name,
            role: data.role,
            acceptUrl: `${baseURL}/invitations/${data.id}`,
          })
        },
      }),
      ...(oauthProviders && oauthProviders.length > 0
        ? [genericOAuth({ config: oauthProviders.map((p) => toGenericOAuthConfig(p, baseURL)) })]
        : []),
    ],
    ...extra,
  })
}
export type AuthInstance = ReturnType<typeof createAuth>

/** 为 Web Route Handler 暴露 Better-Auth 的 Next.js 适配器。 */
export function createNextAuthHandler(auth: AuthInstance) {
  return toNextJsHandler(auth)
}
