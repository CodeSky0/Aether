import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { recordPermissionChange } from '@/lib/audit-write'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({
  requireEntitlement: vi.fn(),
}))

describe('recordPermissionChange', () => {
  it('stores a sha256 hex digest for the target payload', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    const tx = {
      insert: vi.fn(() => ({ values })),
    }
    const target = {
      kind: 'realm_membership',
      role: 'owner',
      actor_id: 'user-1',
    }

    await recordPermissionChange(tx as never, {
      realmId: 'realm-1',
      actor: { actorType: 'human', actorId: 'user-1' },
      target,
      idempotencyKey: 'realm-owner:realm-1:user-1',
      result: { status: 'active' },
    })

    const inserted = values.mock.calls[0]?.[0] as
      | { payload_hash?: unknown }
      | undefined
    const payloadHash = inserted?.payload_hash
    expect(payloadHash).toBe(
      createHash('sha256')
        .update(JSON.stringify(target), 'utf8')
        .digest('hex'),
    )
    expect(payloadHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
