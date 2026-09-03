// @aether/auth · 认证与授权适配层入口
// 对外暴露认证表 schema、Realm Tree 权限模型与实例工厂。
// 下游经本包使用 Better-Auth，不直接依赖 better-auth 包。
export * from './schema.js'
export * from './permissions.js'
export * from './instance.js'
export * from './session-actor.js'
export * from './organization.js'
export * from './user-directory.js'
export * from './mailer.js'
export * from './oidc.js'
