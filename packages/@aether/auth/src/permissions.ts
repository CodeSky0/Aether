// @aether/auth · Realm Tree 三级权限模型
// statements 覆盖 Aether 领域资源；角色继承 organization 插件默认 owner/admin/member
// 并扩展为 Realm > Project > Member 三级嵌套语义。角色名存库（机器可读）用术语。
import { createAccessControl } from 'better-auth/plugins/access'

export const realmStatements = {
  realm: ['read', 'update', 'delete', 'manage_member'],
  project: ['create', 'read', 'update', 'delete'],
  thread: ['create', 'read', 'update', 'resolve', 'archive'],
  entity: ['read', 'create', 'update'],
  current: ['read', 'converge', 'drift'],
  audit: ['read'],
} as const

export const realmAccessControl = createAccessControl(realmStatements)

// 基础权限定义 - 避免重复声明
const basePermissions = {
  thread: ['create', 'read', 'update'] as const,
  entity: ['read'] as const,
  current: ['read', 'converge', 'drift'] as const,
} as const

// 使用展开运算符减少重复，通过组合方式定义角色
export const realmOwnerRole = realmAccessControl.newRole({
  realm: ['read', 'update', 'delete', 'manage_member'],
  project: ['create', 'read', 'update', 'delete'],
  thread: [...basePermissions.thread, 'resolve', 'archive'],
  entity: [...basePermissions.entity, 'create', 'update'],
  current: basePermissions.current,
  audit: ['read'],
})

export const realmAdminRole = realmAccessControl.newRole({
  realm: ['read', 'update', 'manage_member'],
  project: ['create', 'read', 'update', 'delete'],
  thread: [...basePermissions.thread, 'resolve', 'archive'],
  entity: [...basePermissions.entity, 'create', 'update'],
  current: basePermissions.current,
  audit: ['read'],
})

export const realmMemberRole = realmAccessControl.newRole({
  realm: ['read'],
  project: ['read'],
  thread: basePermissions.thread,
  entity: basePermissions.entity,
  current: basePermissions.current,
  audit: [],
})

// viewer：纯只读观察者——可读 Currents/Threads/Entities，不能编辑代码、发评论、
// 创建 Thread 或推动 Current（converge/drift）。审计可读以支撑只读面板。
export const realmViewerRole = realmAccessControl.newRole({
  realm: ['read'],
  project: ['read'],
  thread: ['read'],
  entity: ['read'],
  current: ['read'],
  audit: ['read'],
})

export const realmRoles = {
  owner: realmOwnerRole,
  admin: realmAdminRole,
  member: realmMemberRole,
  viewer: realmViewerRole,
}
