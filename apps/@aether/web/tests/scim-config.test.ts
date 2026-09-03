import { describe, expect, it } from 'vitest'
import { resolveScimConfig } from '@/lib/scim/config'

const TOKEN = 'scim-token-0123456789abcdef'
const REALM_ID = '01234567-89ab-cdef-0123-456789abcdef'

describe('resolveScimConfig', () => {
  it('returns null when no SCIM variables are set', () => {
    expect(resolveScimConfig({})).toBeNull()
  })

  it('returns null for empty / whitespace-only values', () => {
    expect(resolveScimConfig({ AETHER_SCIM_TOKEN: '', AETHER_SCIM_REALM_ID: ' ' })).toBeNull()
  })

  it('returns the config when both variables are set', () => {
    expect(
      resolveScimConfig({
        AETHER_SCIM_TOKEN: TOKEN,
        AETHER_SCIM_REALM_ID: REALM_ID,
      }),
    ).toEqual({ token: TOKEN, realmId: REALM_ID })
  })

  it('throws a readable error when only the token is set', () => {
    expect(() => resolveScimConfig({ AETHER_SCIM_TOKEN: TOKEN })).toThrow(
      /AETHER_SCIM_TOKEN and AETHER_SCIM_REALM_ID must be set together/,
    )
  })

  it('throws a readable error when only the realm id is set', () => {
    expect(() => resolveScimConfig({ AETHER_SCIM_REALM_ID: REALM_ID })).toThrow(
      /must be set together/,
    )
  })

  it('rejects tokens shorter than 16 characters', () => {
    expect(() =>
      resolveScimConfig({
        AETHER_SCIM_TOKEN: 'short-token',
        AETHER_SCIM_REALM_ID: REALM_ID,
      }),
    ).toThrow(/at least 16 characters/)
  })

  it('rejects non-UUID realm ids', () => {
    expect(() =>
      resolveScimConfig({
        AETHER_SCIM_TOKEN: TOKEN,
        AETHER_SCIM_REALM_ID: 'my-realm',
      }),
    ).toThrow(/must be a UUID/)
  })
})
