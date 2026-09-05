// OAuth App Registry 服务层测试（lib/oauth/service.ts）
// 覆盖：authorize 校验矩阵（fail-closed：app / realm / redirect_uri / scope）、
// code 兑换矩阵（重放 / 过期 / 错 secret / redirect_uri 不一致 / PKCE）、
// token 轮换吊销、resolveOAuthToken 三重校验。
// db 以可链式 mock 注入（service 层函数显式接收 CoreDatabase）。
import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-write', () => ({
  recordPermissionChange: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { recordPermissionChange } from '@/lib/audit-write'
import { sha256Hex } from '@aether/resonance'
import {
  buildAuthorizeRedirect,
  exchangeToken,
  issueAuthorizationCode,
  resolveOAuthToken,
  validateAuthorizeRequest,
} from '@/lib/oauth/service'
import type { AuthorizeQuery, TokenRequest } from '@/lib/oauth/protocol'

const mockedRecordPermissionChange = vi.mocked(recordPermissionChange)

const REALM_ID = '123e4567-e89b-12d3-a456-426614174000'
const APP_ID = '323e4567-e89b-12d3-a456-426614174004'
const REDIRECT_URI = 'https://ci.example.com/callback'

const appRow = {
  id: APP_ID,
  name: 'CI Bot',
  client_id: 'oapp_ci',
  realm_id: REALM_ID,
  redirect_uris: [REDIRECT_URI],
}

const realmRow = {
  id: REALM_ID,
  name: 'Alpha',
  slug: 'alpha',
}

function authorizeQuery(overrides: Partial<AuthorizeQuery> = {}): AuthorizeQuery {
  return {
    client_id: 'oapp_ci',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    realm_id: REALM_ID,
    ...overrides,
  }
}

function tokenRequest(overrides: Partial<TokenRequest> = {}): TokenRequest {
  return {
    grant_type: 'authorization_code',
    client_id: 'oapp_ci',
    client_secret: 'osec_correct_secret',
    code: 'oac_thecode',
    redirect_uri: REDIRECT_URI,
    ...overrides,
  }
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'authz-1',
    app_id: APP_ID,
    realm_id: REALM_ID,
    user_id: 'user-1',
    scopes: ['read'],
    redirect_uri: REDIRECT_URI,
    code_expires_at: new Date(Date.now() + 5 * 60 * 1000),
    code_challenge: null,
    exchanged_at: null,
    revoked_at: null,
    ...overrides,
  }
}

/** 可链式查询 mock：select().from().where().limit() 队列消费结果。 */
function makeChain(rows: unknown[]): Record<string, unknown> {
  const promise = Promise.resolve(rows)
  const self: Record<string, unknown> = {
    innerJoin: () => self,
    limit: () => self,
    orderBy: () => self,
    where: () => self,
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  }
  return self
}

interface MockDbConfig {
  selectResults?: unknown[][]
}

function mockDb(config: MockDbConfig = {}) {
  let index = 0
  const next = () => makeChain(config.selectResults?.[index++] ?? [])
  const insertPayloads: unknown[] = []
  const tx = {
    insert: vi.fn(() => ({
      values: (payload: unknown) => {
        insertPayloads.push(payload)
        return makeChain([])
      },
    })),
    update: vi.fn(() => ({ set: () => makeChain([]) })),
  }
  const db = {
    select: vi.fn(() => ({ from: next })),
    transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    ...tx,
  }
  return { db: db as never, tx, insertPayloads }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- validateAuthorizeRequest（authorize 校验矩阵）----

describe('validateAuthorizeRequest', () => {
  it('全部通过 → 返回同意页上下文', async () => {
    const { db } = mockDb({ selectResults: [[appRow], [realmRow]] })
    const result = await validateAuthorizeRequest(db, authorizeQuery())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.context.app.clientId).toBe('oapp_ci')
      expect(result.context.realm.slug).toBe('alpha')
      expect(result.context.scopes).toEqual(['read'])
    }
  })

  it('app 不存在 → 错误（不渲染同意页）', async () => {
    const { db } = mockDb({ selectResults: [[]] })
    const result = await validateAuthorizeRequest(db, authorizeQuery())
    expect(result).toEqual({ ok: false, error: 'Unknown client_id for this realm.' })
  })

  it('app 存在但 realm 不匹配 → 错误', async () => {
    const { db } = mockDb({
      selectResults: [[{ ...appRow, realm_id: 'other-realm' }]],
    })
    const result = await validateAuthorizeRequest(db, authorizeQuery())
    expect(result.ok).toBe(false)
  })

  it('redirect_uri 不在注册白名单 → 错误（精确匹配，无前缀放行）', async () => {
    const { db } = mockDb({ selectResults: [[appRow]] })
    const result = await validateAuthorizeRequest(
      db,
      authorizeQuery({ redirect_uri: 'https://ci.example.com/callback/extra' }),
    )
    expect(result).toEqual({
      ok: false,
      error: 'redirect_uri is not registered for this app.',
    })
  })

  it('realm 不存在（或已软删）→ 错误', async () => {
    const { db } = mockDb({ selectResults: [[appRow], []] })
    const result = await validateAuthorizeRequest(db, authorizeQuery())
    expect(result).toEqual({ ok: false, error: 'Realm not found.' })
  })

  it('scope 越界 → 错误（fail-closed）', async () => {
    const { db } = mockDb({ selectResults: [[appRow], [realmRow]] })
    const result = await validateAuthorizeRequest(
      db,
      authorizeQuery({ scope: 'read admin' }),
    )
    expect(result).toEqual({ ok: false, error: 'Invalid scope.' })
  })
})

// ---- buildAuthorizeRedirect ----

describe('buildAuthorizeRedirect', () => {
  it('透传 code 与 state 到回调 URI', () => {
    const url = buildAuthorizeRedirect(REDIRECT_URI, {
      code: 'oac_abc',
      state: 'xyz',
    })
    expect(url).toBe(`${REDIRECT_URI}?code=oac_abc&state=xyz`)
  })

  it('error=access_denied + state（拒绝路径）', () => {
    const url = buildAuthorizeRedirect(REDIRECT_URI, {
      error: 'access_denied',
      state: 's1',
    })
    expect(url).toBe(`${REDIRECT_URI}?error=access_denied&state=s1`)
  })

  it('undefined 参数不产生空键值对', () => {
    const url = buildAuthorizeRedirect(REDIRECT_URI, { code: 'oac_abc', state: undefined })
    expect(url).toBe(`${REDIRECT_URI}?code=oac_abc`)
  })
})

// ---- issueAuthorizationCode ----

describe('issueAuthorizationCode', () => {
  it('入库 code 哈希（明文不落库）、TTL 10 分钟、落权限审计', async () => {
    const before = Date.now()
    const { db, insertPayloads } = mockDb()
    const context = {
      app: { id: APP_ID, name: 'CI Bot', clientId: 'oapp_ci' },
      realm: { id: REALM_ID, name: 'Alpha', slug: 'alpha' },
      scopes: ['read'],
      state: undefined,
      redirectUri: REDIRECT_URI,
      codeChallenge: undefined,
    }
    const result = await issueAuthorizationCode(db, { context, userId: 'user-1' })

    expect(result.code.startsWith('oac_')).toBe(true)
    const payload = insertPayloads[0] as {
      code_hash: string
      code_expires_at: Date
      code_challenge: string | null
      code_challenge_method: string | null
    }
    // 明文绝不入库：code_hash 是 sha256(code) 的十六进制
    expect(payload.code_hash).toBe(await sha256Hex(result.code))
    expect(payload.code_hash).not.toContain(result.code)
    expect(payload.code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.code_expires_at.getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000)
    expect(payload.code_challenge).toBeNull()
    expect(payload.code_challenge_method).toBeNull()
    expect(mockedRecordPermissionChange).toHaveBeenCalledTimes(1)
  })
})

// ---- exchangeToken（兑换矩阵）----

describe('exchangeToken', () => {
  const appSecretRow = {
    id: APP_ID,
    realm_id: REALM_ID,
    client_secret_hash: createHash('sha256')
      .update('osec_correct_secret')
      .digest('hex'),
  }

  function exchangeDb(grant: Record<string, unknown> | null) {
    return mockDb({
      selectResults: [[appSecretRow], grant === null ? [] : [grant]],
    })
  }

  it('成功：返回 aoat_ token（明文一次）+ Bearer + scope', async () => {
    const { db } = exchangeDb(grantRow())
    const response = await exchangeToken(db, tokenRequest())
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      access_token: string
      token_type: string
      scope: string
    }
    expect(body.access_token.startsWith('aoat_')).toBe(true)
    expect(body.token_type).toBe('Bearer')
    expect(body.scope).toBe('read')
  })

  it('client_secret 错误 → 401 invalid_client', async () => {
    const { db } = exchangeDb(grantRow())
    const response = await exchangeToken(
      db,
      tokenRequest({ client_secret: 'osec_wrong' }),
    )
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_client')
  })

  it('code 未知 → 400 invalid_grant', async () => {
    const { db } = exchangeDb(null)
    const response = await exchangeToken(db, tokenRequest())
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  it('code 已兑换（重放）→ 400 invalid_grant', async () => {
    const { db } = exchangeDb(grantRow({ exchanged_at: new Date() }))
    const response = await exchangeToken(db, tokenRequest())
    expect(response.status).toBe(400)
  })

  it('code 过期 → 400 invalid_grant', async () => {
    const { db } = exchangeDb(grantRow({ code_expires_at: new Date(Date.now() - 1000) }))
    const response = await exchangeToken(db, tokenRequest())
    expect(response.status).toBe(400)
  })

  it('code 已吊销 → 400 invalid_grant', async () => {
    const { db } = exchangeDb(grantRow({ revoked_at: new Date() }))
    const response = await exchangeToken(db, tokenRequest())
    expect(response.status).toBe(400)
  })

  it('grant 属于其他 app（code 窃用）→ 400 invalid_grant', async () => {
    const { db } = exchangeDb(grantRow({ app_id: 'other-app' }))
    const response = await exchangeToken(db, tokenRequest())
    expect(response.status).toBe(400)
  })

  it('redirect_uri 与 authorize 时不一致 → 400 invalid_grant', async () => {
    const { db } = exchangeDb(grantRow())
    const response = await exchangeToken(
      db,
      tokenRequest({ redirect_uri: 'https://ci.example.com/other' }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  describe('PKCE（S256）', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

    it('authorize 带 challenge：兑换缺 verifier → 400', async () => {
      const { db } = exchangeDb(grantRow({ code_challenge: challenge }))
      const response = await exchangeToken(db, tokenRequest())
      expect(response.status).toBe(400)
    })

    it('verifier 不匹配 challenge → 400', async () => {
      const { db } = exchangeDb(grantRow({ code_challenge: challenge }))
      const response = await exchangeToken(
        db,
        tokenRequest({
          code_verifier:
            'totally-wrong-verifier-value-which-is-long-enough-43-plus-chars',
        }),
      )
      expect(response.status).toBe(400)
    })

    it('verifier 匹配 → 200', async () => {
      const { db } = exchangeDb(grantRow({ code_challenge: challenge }))
      const response = await exchangeToken(db, tokenRequest({ code_verifier: verifier }))
      expect(response.status).toBe(200)
    })
  })

  it('成功兑换事务：轮换吊销 + token 哈希写入 + 审计', async () => {
    const { db, tx } = exchangeDb(grantRow())
    const response = await exchangeToken(db, tokenRequest())
    expect(response.status).toBe(200)
    // 轮换吊销 + 本行 token 写入（两次 update）+ 审计一次
    expect(tx.update).toHaveBeenCalledTimes(2)
    expect(mockedRecordPermissionChange).toHaveBeenCalledTimes(1)
  })
})

// ---- resolveOAuthToken（三重 fail-closed）----

describe('resolveOAuthToken', () => {
  const tokenRow = {
    authorizationId: 'authz-1',
    appId: APP_ID,
    appName: 'CI Bot',
    clientId: 'oapp_ci',
    userId: 'user-1',
    scopes: ['read'],
    realmId: REALM_ID,
    realmSlug: 'alpha',
    realmName: 'Alpha',
    realmCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
    realmUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
  }

  it('全部通过 → 返回解析上下文', async () => {
    const { db } = mockDb({ selectResults: [[tokenRow], [{ id: 'member-1' }]] })
    const resolved = await resolveOAuthToken(db, 'aoat_valid')
    expect(resolved?.authorizationId).toBe('authz-1')
    expect(resolved?.clientId).toBe('oapp_ci')
    expect(resolved?.scopes).toEqual(['read'])
  })

  it('token 未命中 / 已吊销 / app 软删（join 过滤后无行）→ null', async () => {
    const { db } = mockDb({ selectResults: [[]] })
    expect(await resolveOAuthToken(db, 'aoat_unknown')).toBeNull()
  })

  it('授权用户失去 active membership → null（fail-closed）', async () => {
    const { db } = mockDb({ selectResults: [[tokenRow], []] })
    expect(await resolveOAuthToken(db, 'aoat_valid')).toBeNull()
  })
})
