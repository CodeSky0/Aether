import { describe, expect, it } from 'vitest'

import { resolveOidcProviderConfig } from '@/lib/auth'

describe('resolveOidcProviderConfig', () => {
  it('returns null when no OIDC variables are set', () => {
    expect(resolveOidcProviderConfig({})).toBeNull()
    expect(
      resolveOidcProviderConfig({
        AETHER_OIDC_DISCOVERY_URL: '  ',
        AETHER_OIDC_CLIENT_ID: '',
      }),
    ).toBeNull()
  })

  it('throws a readable error when only one of discoveryUrl / clientId is set', () => {
    expect(() =>
      resolveOidcProviderConfig({
        AETHER_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
      }),
    ).toThrow('AETHER_OIDC_DISCOVERY_URL and AETHER_OIDC_CLIENT_ID must be set together')

    expect(() =>
      resolveOidcProviderConfig({
        AETHER_OIDC_CLIENT_ID: 'client-1',
      }),
    ).toThrow('AETHER_OIDC_DISCOVERY_URL and AETHER_OIDC_CLIENT_ID must be set together')
  })

  it('applies defaults for providerId, name and scopes', () => {
    const provider = resolveOidcProviderConfig({
      AETHER_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
      AETHER_OIDC_CLIENT_ID: 'client-1',
    })

    expect(provider).toEqual({
      providerId: 'oidc',
      name: 'SSO',
      discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      clientId: 'client-1',
      clientSecret: undefined,
      scopes: undefined,
      pkce: false,
      issuer: undefined,
    })
  })

  it('parses scopes, pkce and optional secret from the environment', () => {
    const provider = resolveOidcProviderConfig({
      AETHER_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
      AETHER_OIDC_CLIENT_ID: 'client-1',
      AETHER_OIDC_CLIENT_SECRET: 'secret-1',
      AETHER_OIDC_PROVIDER_ID: 'keycloak',
      AETHER_OIDC_NAME: '企业 SSO',
      AETHER_OIDC_SCOPES: 'openid email  groups ',
      AETHER_OIDC_PKCE: 'true',
      AETHER_OIDC_ISSUER: 'https://idp.example',
    })

    expect(provider).toEqual({
      providerId: 'keycloak',
      name: '企业 SSO',
      discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      scopes: ['openid', 'email', 'groups'],
      pkce: true,
      issuer: 'https://idp.example',
    })
  })

  it('treats PKCE values other than the literal true as disabled', () => {
    const provider = resolveOidcProviderConfig({
      AETHER_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
      AETHER_OIDC_CLIENT_ID: 'client-1',
      AETHER_OIDC_PKCE: '1',
    })

    expect(provider?.pkce).toBe(false)
  })
})
