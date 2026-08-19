import { describe, expect, it } from 'vitest'

import {
  DEFAULT_OIDC_SCOPES,
  toGenericOAuthConfig,
  type OidcProviderConfig,
} from '../src/oidc.js'

const BASE_URL = 'https://aether.example'

describe('toGenericOAuthConfig', () => {
  it('builds the canonical redirect URI from baseURL and providerId', () => {
    const config = toGenericOAuthConfig(
      {
        providerId: 'oidc',
        name: '企业 SSO',
        discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
        clientId: 'client-1',
        clientSecret: 'secret-1',
      },
      BASE_URL,
    )

    expect(config.redirectURI).toBe(`${BASE_URL}/api/auth/oauth2/callback/oidc`)
    expect(config.providerId).toBe('oidc')
    expect(config.discoveryUrl).toBe(
      'https://idp.example/.well-known/openid-configuration',
    )
    expect(config.clientId).toBe('client-1')
    expect(config.clientSecret).toBe('secret-1')
  })

  it('defaults scopes to openid email profile', () => {
    const config = toGenericOAuthConfig(
      {
        providerId: 'oidc',
        name: 'SSO',
        discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
        clientId: 'client-1',
      },
      BASE_URL,
    )

    expect(config.scopes).toEqual(['openid', 'email', 'profile'])
    expect(DEFAULT_OIDC_SCOPES).toEqual(['openid', 'email', 'profile'])
  })

  it('passes through explicit scopes, pkce, issuer and optional secret', () => {
    const config = toGenericOAuthConfig(
      {
        providerId: 'keycloak',
        name: 'Keycloak',
        discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
        clientId: 'client-1',
        scopes: ['openid', 'groups'],
        pkce: true,
        issuer: 'https://idp.example',
      },
      BASE_URL,
    )

    expect(config.scopes).toEqual(['openid', 'groups'])
    expect(config.pkce).toBe(true)
    expect(config.issuer).toBe('https://idp.example')
    expect(config.clientSecret).toBeUndefined()
  })

  it('does not mutate the caller-provided scope array', () => {
    const scopes = ['openid', 'email']
    const provider: OidcProviderConfig = {
      providerId: 'oidc',
      name: 'SSO',
      discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      clientId: 'client-1',
      scopes,
    }

    const config = toGenericOAuthConfig(provider, BASE_URL)
    config.scopes!.push('profile')

    expect(scopes).toEqual(['openid', 'email'])
  })
})
