import { describe, expect, it } from 'vitest'
import { betterAuthSchema } from '../src/schema.js'

describe('Better-Auth schema collection', () => {
  it('contains only the seven Better-Auth model tables', () => {
    expect(Object.keys(betterAuthSchema).sort()).toEqual([
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
