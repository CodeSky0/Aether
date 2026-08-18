import { describe, expect, it, vi } from 'vitest'
import type { AuthInstance } from '../src/instance.js'
import { resolveSessionActor } from '../src/session-actor.js'

function mockAuth(
  result: unknown,
): { auth: AuthInstance; getSession: ReturnType<typeof vi.fn> } {
  const getSession = vi.fn().mockResolvedValue(result)
  const auth = {
    api: { getSession },
  } as unknown as AuthInstance
  return { auth, getSession }
}

describe('resolveSessionActor', () => {
  it('透传 headers 并映射 human session actor', async () => {
    const headers = new Headers({ cookie: 'better-auth.session=token' })
    const { auth, getSession } = mockAuth({
      user: { id: 'user-123' },
      session: { activeOrganizationId: 'realm-456' },
    })

    await expect(resolveSessionActor(auth, headers)).resolves.toEqual({
      actorType: 'human',
      actorId: 'user-123',
      activeRealmId: 'realm-456',
    })
    expect(getSession).toHaveBeenCalledWith({ headers })
  })

  it('无会话时返回 null', async () => {
    const { auth } = mockAuth(null)
    await expect(resolveSessionActor(auth, new Headers())).resolves.toBeNull()
  })

  it('没有 active organization 时返回 null Realm', async () => {
    const { auth } = mockAuth({
      user: { id: 'user-123' },
      session: {},
    })
    await expect(resolveSessionActor(auth, new Headers())).resolves.toEqual({
      actorType: 'human',
      actorId: 'user-123',
      activeRealmId: null,
    })
  })
})
