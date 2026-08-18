import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSessionActor } from '@aether/auth'
import { tryGetAuth } from '@/lib/auth'
import { resolveCurrentActor } from '@/lib/auth-guard'

vi.mock('@aether/auth', () => ({
  resolveSessionActor: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  tryGetAuth: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

const mockedResolveSessionActor = vi.mocked(resolveSessionActor)
const mockedTryGetAuth = vi.mocked(tryGetAuth)

describe('resolveCurrentActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('认证环境变量未配置时返回 null', async () => {
    mockedTryGetAuth.mockReturnValue(null)

    await expect(resolveCurrentActor()).resolves.toBeNull()
    expect(mockedResolveSessionActor).not.toHaveBeenCalled()
  })

  it('会话解析抛错时返回 null', async () => {
    const auth = {} as NonNullable<ReturnType<typeof tryGetAuth>>
    mockedTryGetAuth.mockReturnValue(auth)
    mockedResolveSessionActor.mockRejectedValue(new Error('session unavailable'))

    await expect(resolveCurrentActor()).resolves.toBeNull()
    await expect(resolveCurrentActor()).resolves.toBeNull()
    expect(mockedResolveSessionActor).toHaveBeenCalledTimes(2)
  })
})
