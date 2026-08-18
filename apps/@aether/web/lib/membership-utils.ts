// @aether/web · 占位 organization 判断；独立于 `'use server'` 模块以提供同步复用辅助函数。
export { isPlaceholderOrganization } from '@aether/auth'

/** Realm 仍绑占位 organization 时的错误文案；页面据此给出回填脚本提示。 */
export const UNBOUND_REALM_ORGANIZATION_MESSAGE =
  'Realm is not bound to a Better-Auth organization; rebuild or bind the Realm first'
