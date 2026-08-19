import { afterEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('better-auth/plugins/generic-oauth', () => ({
  genericOAuth: vi.fn((options: unknown) => ({ id: 'generic-oauth', options })),
}))

import { createAuth } from '../src/instance.js'

describe('createAuth invitation mailer', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('maps Better-Auth invitation data to the injected mailer', async () => {
    const sendInvitation = vi.fn().mockResolvedValue(undefined)
    const config = createAuth({
      db: {},
      baseURL: 'https://aether.example',
      secret: 'test-secret',
      mailer: { sendInvitation },
    }) as unknown as {
      plugins: unknown[]
    }
    const plugin = config.plugins[0] as {
      sendInvitationEmail: (data: {
        id: string
        email: string
        role: string
        organization: { name: string }
        invitation: unknown
        inviter: unknown
      }) => Promise<void>
    }

    await plugin.sendInvitationEmail({
      id: 'invite-1',
      email: 'member@example.com',
      role: 'admin',
      organization: { name: 'Aether' },
      invitation: {},
      inviter: {},
    })

    expect(sendInvitation).toHaveBeenCalledWith({
      to: 'member@example.com',
      realmName: 'Aether',
      role: 'admin',
      acceptUrl: 'https://aether.example/invitations/invite-1',
    })
  })

  it('defers provider configuration errors until an invitation is sent', async () => {
    vi.stubEnv('AETHER_MAIL_PROVIDER', 'resend')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('AETHER_MAIL_FROM', '')

    const config = createAuth({
      db: {},
      baseURL: 'https://aether.example',
      secret: 'test-secret',
    }) as unknown as {
      plugins: unknown[]
    }
    expect(config).toBeDefined()

    const plugin = config.plugins[0] as {
      sendInvitationEmail: (data: {
        id: string
        email: string
        role: string
        organization: { name: string }
        invitation: unknown
        inviter: unknown
      }) => Promise<void>
    }
    await expect(
      plugin.sendInvitationEmail({
        id: 'invite-1',
        email: 'member@example.com',
        role: 'member',
        organization: { name: 'Aether' },
        invitation: {},
        inviter: {},
      }),
    ).rejects.toThrow('requires RESEND_API_KEY and AETHER_MAIL_FROM')
  })
})

describe('createAuth oauthProviders', () => {
  it('registers the genericOAuth plugin with mapped provider configs', () => {
    const config = createAuth({
      db: {},
      baseURL: 'https://aether.example',
      secret: 'test-secret',
      oauthProviders: [
        {
          providerId: 'oidc',
          name: '企业 SSO',
          discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
          clientId: 'client-1',
          clientSecret: 'secret-1',
          pkce: true,
        },
      ],
    }) as unknown as { plugins: { id: string; options: unknown }[] }

    const oauthPlugin = config.plugins.find((p) => p.id === 'generic-oauth')
    expect(oauthPlugin).toBeDefined()
    expect(oauthPlugin!.options).toEqual({
      config: [
        {
          providerId: 'oidc',
          discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
          clientId: 'client-1',
          clientSecret: 'secret-1',
          scopes: ['openid', 'email', 'profile'],
          pkce: true,
          issuer: undefined,
          redirectURI: 'https://aether.example/api/auth/oauth2/callback/oidc',
        },
      ],
    })
  })

  it('keeps the plugin list unchanged when no providers are configured', () => {
    const withoutProviders = createAuth({
      db: {},
      baseURL: 'https://aether.example',
      secret: 'test-secret',
    }) as unknown as { plugins: { id: string }[] }
    expect(withoutProviders.plugins).toHaveLength(1)
    expect(withoutProviders.plugins[0]!.id).toBeUndefined()

    const withEmptyProviders = createAuth({
      db: {},
      baseURL: 'https://aether.example',
      secret: 'test-secret',
      oauthProviders: [],
    }) as unknown as { plugins: { id: string }[] }
    expect(withEmptyProviders.plugins).toHaveLength(1)
  })
})
