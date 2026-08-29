import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth-guard', () => ({
  requireEntitlement: vi.fn().mockResolvedValue(undefined),
  requireRealmAccess: vi.fn().mockResolvedValue(undefined),
  resolveCurrentActor: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({ name: 'mock-db' })),
}))

vi.mock('@/lib/current/broadcast', () => ({
  getBroadcastPort: vi.fn(() => ({ name: 'mock-broadcast' })),
}))

vi.mock('@/lib/current/channel-service', () => ({
  appendUpdate: vi.fn(),
  getCursor: vi.fn(),
  replayUpdates: vi.fn(),
}))

import { appendCurrentUpdate } from '@/app/actions/current'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { appendUpdate } from '@/lib/current/channel-service'

const mockedResolveCurrentActor = vi.mocked(resolveCurrentActor)
const mockedAppendUpdate = vi.mocked(appendUpdate)

const input = {
  realmId: '550e8400-e29b-41d4-a716-446655440000',
  docRef: 'doc:current',
  serializedPayload: 'serialized-update',
  idempotencyKey: 'operation-1',
}

describe('appendCurrentUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedAppendUpdate.mockResolvedValue({ seq: 1, deduplicated: false })
  })

  it('无会话时服务端注入 web-client actor', async () => {
    mockedResolveCurrentActor.mockResolvedValue(null)

    const result = await appendCurrentUpdate(input)

    expect(result).toEqual({
      success: true,
      data: { seq: 1, deduplicated: false },
    })
    expect(mockedAppendUpdate).toHaveBeenCalledWith(
      { name: 'mock-db' },
      { name: 'mock-broadcast' },
      { ...input, actorType: 'human', actorId: 'web-client' },
    )
  })

  it('有会话时服务端注入会话 actor', async () => {
    mockedResolveCurrentActor.mockResolvedValue({
      actorType: 'human',
      actorId: 'user-123',
    })

    const result = await appendCurrentUpdate(input)

    expect(result).toEqual({
      success: true,
      data: { seq: 1, deduplicated: false },
    })
    expect(mockedAppendUpdate).toHaveBeenCalledWith(
      { name: 'mock-db' },
      { name: 'mock-broadcast' },
      { ...input, actorType: 'human', actorId: 'user-123' },
    )
  })

  it('对外契约不接受客户端 actor 字段', () => {
    // @ts-expect-error actor fields are intentionally server-owned
    void appendCurrentUpdate({ ...input, actorType: 'entity', actorId: 'forged' })
  })
})
