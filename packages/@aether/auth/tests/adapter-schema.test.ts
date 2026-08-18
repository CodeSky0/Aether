import { describe, expect, it, vi } from 'vitest'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

vi.mock('better-auth', () => ({
  betterAuth: vi.fn((options: unknown) => options),
}))
vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({})),
}))
vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(),
}))
vi.mock('better-auth/plugins', () => ({
  organization: vi.fn((options: unknown) => options),
}))

import { createAuth } from '../src/instance.js'

describe('Better-Auth Drizzle adapter schema', () => {
  it('receives all seven Better-Auth model tables', () => {
    createAuth({
      db: {},
      baseURL: 'https://aether.example',
      secret: 'test-secret',
      mailer: { sendInvitation: vi.fn().mockResolvedValue(undefined) },
    })

    const adapterOptions = vi.mocked(drizzleAdapter).mock.calls[0]?.[1] as
      | { schema?: Record<string, unknown> }
      | undefined
    expect(Object.keys(adapterOptions?.schema ?? {}).sort()).toEqual([
      'account',
      'invitation',
      'member',
      'organization',
      'session',
      'user',
      'verification',
    ])
  })
})
