// @aether/resonance OAuth App Registry 纯函数层测试
// 覆盖：凭据生成格式（前缀 + base64url 字符集）、PKCE S256（RFC 7636
// 已知向量交叉验证）、scope 目录解析与 method 强制、redirect_uri 策略
// （https 限定 + loopback 例外 + 精确匹配）、sha256Hex（node:crypto 交叉验证）。
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_AUTHORIZATION_CODE_PREFIX,
  OAUTH_CLIENT_ID_PREFIX,
  OAUTH_CLIENT_SECRET_PREFIX,
  OAUTH_DEFAULT_SCOPES,
  generateAccessToken,
  generateAuthorizationCode,
  generateClientId,
  generateClientSecret,
  isAllowedRedirectUri,
  isReadMethod,
  isValidPkceValue,
  matchesRedirectUri,
  parseOAuthScopes,
  scopeAllowsMethod,
  sha256Hex,
  verifyPkceS256,
} from '@aether/resonance'

const BASE64URL = /^[A-Za-z0-9_-]+$/

describe('凭据生成', () => {
  it('四类凭据携带各自前缀且 body 为 base64url', () => {
    const clientId = generateClientId()
    const clientSecret = generateClientSecret()
    const code = generateAuthorizationCode()
    const token = generateAccessToken()

    expect(clientId.startsWith(OAUTH_CLIENT_ID_PREFIX)).toBe(true)
    expect(clientSecret.startsWith(OAUTH_CLIENT_SECRET_PREFIX)).toBe(true)
    expect(code.startsWith(OAUTH_AUTHORIZATION_CODE_PREFIX)).toBe(true)
    expect(token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)).toBe(true)

    for (const value of [clientId, clientSecret, code, token]) {
      const body = value.slice(value.indexOf('_') + 1)
      expect(BASE64URL.test(body)).toBe(true)
    }
  })

  it('随机性：同批生成不重复', () => {
    const secrets = new Set(Array.from({ length: 32 }, () => generateClientSecret()))
    expect(secrets.size).toBe(32)
  })
})

describe('sha256Hex', () => {
  it('与 node:crypto sha256 十六进制输出一致', async () => {
    const plaintext = 'aoat_cross_check_vector'
    const expected = createHash('sha256').update(plaintext).digest('hex')
    await expect(sha256Hex(plaintext)).resolves.toBe(expected)
  })
})

describe('PKCE（S256）', () => {
  // RFC 7636 附录 B 向量：verifier → challenge
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

  it('RFC 7636 已知向量校验通过', async () => {
    await expect(verifyPkceS256(verifier, challenge)).resolves.toBe(true)
  })

  it('verifier 不匹配 challenge → false', async () => {
    await expect(verifyPkceS256(verifier, 'not-the-challenge')).resolves.toBe(false)
  })

  it('非法长度 / 字符集（非 base64url）恒 false，不触发哈希', async () => {
    await expect(verifyPkceS256('short', challenge)).resolves.toBe(false)
    await expect(verifyPkceS256(`${verifier}+bad`, challenge)).resolves.toBe(false)
    await expect(verifyPkceS256(verifier, 'short')).resolves.toBe(false)
  })

  it('isValidPkceValue：43-128 base64url 字符', () => {
    expect(isValidPkceValue(verifier)).toBe(true)
    expect(isValidPkceValue('a'.repeat(42))).toBe(false)
    expect(isValidPkceValue('a'.repeat(129))).toBe(false)
    expect(isValidPkceValue('a'.repeat(43))).toBe(true)
  })
})

describe('scope 解析与强制', () => {
  it('缺省 / 空白 → 默认 read', () => {
    expect(parseOAuthScopes(undefined)).toEqual(OAUTH_DEFAULT_SCOPES)
    expect(parseOAuthScopes(null)).toEqual(OAUTH_DEFAULT_SCOPES)
    expect(parseOAuthScopes('')).toEqual(OAUTH_DEFAULT_SCOPES)
    expect(parseOAuthScopes('   ')).toEqual(OAUTH_DEFAULT_SCOPES)
  })

  it('空格分隔解析并去重', () => {
    expect(parseOAuthScopes('read')).toEqual(['read'])
    expect(parseOAuthScopes('read write')).toEqual(['read', 'write'])
    expect(parseOAuthScopes('write read read')).toEqual(['write', 'read'])
  })

  it('越界 scope → null（fail-closed，不静默裁剪）', () => {
    expect(parseOAuthScopes('read admin')).toBeNull()
    expect(parseOAuthScopes('readwrite')).toBeNull()
  })

  it('GET/HEAD 需 read；其余 method 需 write', () => {
    expect(isReadMethod('GET')).toBe(true)
    expect(isReadMethod('head')).toBe(true)
    expect(isReadMethod('POST')).toBe(false)

    expect(scopeAllowsMethod(['read'], 'GET')).toBe(true)
    expect(scopeAllowsMethod(['read'], 'POST')).toBe(false)
    expect(scopeAllowsMethod(['read', 'write'], 'DELETE')).toBe(true)
    expect(scopeAllowsMethod(['write'], 'GET')).toBe(false)
  })
})

describe('redirect_uri 策略', () => {
  it('https 放行；http 仅 loopback 例外', () => {
    expect(isAllowedRedirectUri('https://ci.example.com/callback')).toBe(true)
    expect(isAllowedRedirectUri('http://localhost:3000/callback')).toBe(true)
    expect(isAllowedRedirectUri('http://127.0.0.1:8931/cb')).toBe(true)
    expect(isAllowedRedirectUri('http://example.com/callback')).toBe(false)
    expect(isAllowedRedirectUri('ftp://example.com/cb')).toBe(false)
  })

  it('非 URL / 超长 → false', () => {
    expect(isAllowedRedirectUri('not a url')).toBe(false)
    expect(isAllowedRedirectUri(`https://example.com/${'a'.repeat(2100)}`)).toBe(false)
  })

  it('注册匹配采用精确字符串比较（无前缀 / 通配）', () => {
    const registered = ['https://ci.example.com/callback']
    expect(matchesRedirectUri('https://ci.example.com/callback', registered)).toBe(true)
    expect(matchesRedirectUri('https://ci.example.com/callback/other', registered)).toBe(false)
    expect(matchesRedirectUri('https://ci.example.com', registered)).toBe(false)
    expect(matchesRedirectUri('https://evil.example.com/callback', registered)).toBe(false)
  })
})
