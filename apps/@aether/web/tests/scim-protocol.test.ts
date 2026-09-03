import { describe, expect, it } from 'vitest'
import {
  extractPatchChanges,
  parseBoolean,
  parseScimFilter,
  parseScimPagination,
  scimError,
  toListResponse,
  toScimUserResource,
} from '@/lib/scim/protocol'

describe('scimError', () => {
  it('renders the RFC 7644 error envelope', async () => {
    const response = scimError(400, 'bad input')
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('application/scim+json')
    await expect(response.json()).resolves.toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '400',
      detail: 'bad input',
    })
  })
})

describe('toScimUserResource', () => {
  it('maps the internal record onto core SCIM attributes', () => {
    const resource = toScimUserResource(
      {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        active: true,
      },
      'https://aether.example',
    )
    expect(resource).toMatchObject({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: 'user-1',
      userName: 'ada@example.com',
      displayName: 'Ada',
      active: true,
      emails: [{ value: 'ada@example.com', type: 'work', primary: true }],
      meta: {
        resourceType: 'User',
        location: 'https://aether.example/api/scim/v2/Users/user-1',
      },
    })
  })
})

describe('toListResponse', () => {
  it('builds the ListResponse envelope', () => {
    const body = toListResponse({
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 100,
      resources: [],
    })
    expect(body).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 100,
      Resources: [],
    })
  })
})

describe('parseScimPagination', () => {
  it('defaults to startIndex 1 / count 100', () => {
    expect(parseScimPagination(new URLSearchParams())).toEqual({
      startIndex: 1,
      count: 100,
    })
  })

  it('caps count at 200 and clamps invalid values to defaults', () => {
    expect(parseScimPagination(new URLSearchParams('count=500')).count).toBe(200)
    expect(parseScimPagination(new URLSearchParams('count=abc')).count).toBe(100)
    expect(
      parseScimPagination(new URLSearchParams('startIndex=0')).startIndex,
    ).toBe(1)
    expect(
      parseScimPagination(new URLSearchParams('startIndex=3')).startIndex,
    ).toBe(3)
  })
})

describe('parseScimFilter', () => {
  it('parses a single userName eq filter case-insensitively', () => {
    expect(parseScimFilter('userName eq "Ada@Example.com"')).toEqual({
      kind: 'userName',
      value: 'ada@example.com',
    })
  })

  it('returns null when no filter is present', () => {
    expect(parseScimFilter(null)).toBeNull()
  })

  it('marks unsupported filters', () => {
    expect(parseScimFilter('emails.value eq "a@b.c"')?.kind).toBe('unsupported')
    expect(parseScimFilter('userName sw "a" and userName co "b"')?.kind).toBe(
      'unsupported',
    )
  })
})

describe('extractPatchChanges', () => {
  it('reads replace-path active operations', () => {
    expect(
      extractPatchChanges({
        Operations: [{ op: 'Replace', path: 'active', value: false }],
      }),
    ).toEqual({ active: false })
  })

  it('reads value-object form without path', () => {
    expect(
      extractPatchChanges({
        Operations: [{ op: 'replace', value: { active: true } }],
      }),
    ).toEqual({ active: true })
  })

  it('normalizes string booleans emitted by some IdPs', () => {
    expect(
      extractPatchChanges({
        Operations: [{ op: 'replace', path: 'active', value: 'true' }],
      }),
    ).toEqual({ active: true })
  })

  it('supports displayName replace', () => {
    expect(
      extractPatchChanges({
        Operations: [{ op: 'replace', path: 'displayName', value: 'Ada L.' }],
      }),
    ).toEqual({ displayName: 'Ada L.' })
  })

  it('rejects non-replace operations and unknown paths', () => {
    expect(
      extractPatchChanges({
        Operations: [{ op: 'add', path: 'emails', value: [] }],
      }),
    ).toBeNull()
    expect(
      extractPatchChanges({
        Operations: [{ op: 'replace', path: 'name.givenName', value: 'Ada' }],
      }),
    ).toBeNull()
    expect(extractPatchChanges({ Operations: [] })).toBeNull()
    expect(extractPatchChanges('nope')).toBeNull()
  })

  it('rejects invalid active values', () => {
    expect(
      extractPatchChanges({
        Operations: [{ op: 'replace', path: 'active', value: 'yes' }],
      }),
    ).toBeNull()
  })
})

describe('parseBoolean', () => {
  it('accepts booleans and the two string forms', () => {
    expect(parseBoolean(true)).toBe(true)
    expect(parseBoolean('false')).toBe(false)
    expect(parseBoolean('yes')).toBeNull()
    expect(parseBoolean(1)).toBeNull()
  })
})
