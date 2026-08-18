// @aether/entitlement · Drizzle 加载层 Realm 隔离测试
import { describe, expect, it } from 'vitest'
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy'
import { loadEntitlementSubject } from '../src/loader.js'

const realmId = '550e8400-e29b-41d4-a716-446655440000'
const actorId = '4e0f9c1a-0000-0000-0000-000000000001'

describe('loadEntitlementSubject', () => {
  it('通过 realmGuard 查询 Realm 内主体的全部成员记录', async () => {
    const queries: string[] = []
    const callback: RemoteCallback = (sql) => {
      queries.push(sql)
      return Promise.resolve({
        rows: [['human', actorId, 'admin', null, 'active', { 'audit:read': true }]],
      })
    }
    const db = drizzle(callback)

    const subject = await loadEntitlementSubject(db, {
      realmId,
      actorType: 'human',
      actorId,
    })

    expect(subject.memberships).toEqual([
      {
        role: 'admin',
        projectId: null,
        status: 'active',
        entitlements: { 'audit:read': true },
      },
    ])
    expect(queries[0]).toContain('"members"."realm_id" =')
    expect(queries[0]).toContain('"members"."actor_type" =')
    expect(queries[0]).toContain('"members"."actor_id" =')
  })
})
