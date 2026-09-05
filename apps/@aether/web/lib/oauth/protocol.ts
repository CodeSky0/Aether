// @aether/web · OAuth App Registry 协议层
// 纯函数：authorize 查询参数 / token 请求体 / App 注册输入的 zod 校验、
// OAuth 错误响应形状（RFC 6749 §5.2）、资源映射（snake_case + ISO 时间戳）。
// 不接触 db / 会话，全部可单测（沿 resonance protocol.ts 范式）。
import { z } from 'zod'

import {
  isAllowedRedirectUri,
  isValidPkceValue,
  OAUTH_SCOPES,
  parseOAuthScopes,
} from '@aether/resonance'

// ---- 错误响应（RFC 6749 §5.2 形状，token 端点用）----

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'

export function oauthError(
  status: number,
  code: OAuthErrorCode,
  message: string,
): Response {
  return new Response(JSON.stringify({ error: code, error_description: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ---- authorize 查询参数 ----

export const authorizeQuerySchema = z
  .object({
    client_id: z.string().min(1),
    redirect_uri: z.string().min(1),
    response_type: z.literal('code'),
    scope: z.string().optional(),
    state: z.string().max(2048).optional(),
    realm_id: z.string().uuid(),
    code_challenge: z.string().optional(),
    code_challenge_method: z.literal('S256').optional(),
  })
  .superRefine((value, ctx) => {
    if (!isAllowedRedirectUri(value.redirect_uri)) {
      ctx.addIssue({
        code: 'custom',
        path: ['redirect_uri'],
        message: 'redirect_uri must be https (loopback http allowed).',
      })
    }
    const scopes = parseOAuthScopes(value.scope)
    if (scopes === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: `scope only accepts ${OAUTH_SCOPES.join(' / ')} (space-separated).`,
      })
    }
    if (value.code_challenge !== undefined && !isValidPkceValue(value.code_challenge)) {
      ctx.addIssue({
        code: 'custom',
        path: ['code_challenge'],
        message: 'code_challenge must be 43-128 base64url characters.',
      })
    }
    // PKCE 携带 challenge 时必须显式 S256
    if (value.code_challenge !== undefined && value.code_challenge_method !== 'S256') {
      ctx.addIssue({
        code: 'custom',
        path: ['code_challenge_method'],
        message: 'code_challenge_method must be S256.',
      })
    }
  })

export type AuthorizeQuery = z.infer<typeof authorizeQuerySchema>

// ---- token 请求体（JSON）----

export const tokenRequestSchema = z
  .object({
    grant_type: z.literal('authorization_code'),
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    code: z.string().min(1),
    redirect_uri: z.string().min(1),
    code_verifier: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!isAllowedRedirectUri(value.redirect_uri)) {
      ctx.addIssue({
        code: 'custom',
        path: ['redirect_uri'],
        message: 'redirect_uri must be https (loopback http allowed).',
      })
    }
  })

export type TokenRequest = z.infer<typeof tokenRequestSchema>

// ---- App 注册 / 轮换输入（Server Actions）----

export const registerOAuthAppInputSchema = z.object({
  realmId: z.string().uuid('realmId 必须是 UUID'),
  name: z.string().trim().min(1, '应用名称不能为空').max(100, '名称最长 100 字符'),
  redirectUris: z
    .array(z.string().min(1))
    .min(1, '至少填写一个回调 URI')
    .max(10, '回调 URI 最多 10 个')
    .refine((uris) => uris.every(isAllowedRedirectUri), {
      message: '回调 URI 仅接受 https（localhost 例外），且必须是合法 URL',
    })
    .refine((uris) => new Set(uris).size === uris.length, {
      message: '回调 URI 不能重复',
    }),
})

export const rotateOAuthAppSecretInputSchema = z.object({
  realmId: z.string().uuid('realmId 必须是 UUID'),
  appId: z.string().uuid('appId 必须是 UUID'),
})

export const deleteOAuthAppInputSchema = z.object({
  realmId: z.string().uuid('realmId 必须是 UUID'),
  appId: z.string().uuid('appId 必须是 UUID'),
})

export const revokeOAuthAuthorizationInputSchema = z.object({
  realmId: z.string().uuid('realmId 必须是 UUID'),
  authorizationId: z.string().uuid('authorizationId 必须是 UUID'),
})

// ---- 资源映射 ----

export interface OAuthAppRecord {
  id: string
  realm_id: string
  client_id: string
  name: string
  redirect_uris: string[]
  client_secret_prefix: string
  created_at: Date
}

export interface OAuthAuthorizationRecord {
  id: string
  app_id: string
  realm_id: string
  scopes: string[]
  token_prefix: string | null
  token_issued_at: Date | null
  last_used_at: Date | null
  revoked_at: Date | null
  created_at: Date
  app_name?: string
  app_client_id?: string
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

export function toOAuthAppResource(app: OAuthAppRecord): Record<string, unknown> {
  return {
    id: app.id,
    realm_id: app.realm_id,
    client_id: app.client_id,
    name: app.name,
    redirect_uris: app.redirect_uris,
    client_secret_prefix: app.client_secret_prefix,
    created_at: iso(app.created_at),
  }
}

export function toOAuthAuthorizationResource(
  authorization: OAuthAuthorizationRecord,
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    id: authorization.id,
    app_id: authorization.app_id,
    realm_id: authorization.realm_id,
    scopes: authorization.scopes,
    token_prefix: authorization.token_prefix,
    token_issued_at: iso(authorization.token_issued_at),
    last_used_at: iso(authorization.last_used_at),
    revoked_at: iso(authorization.revoked_at),
    created_at: iso(authorization.created_at),
  }
  if (authorization.app_name !== undefined) {
    resource.app_name = authorization.app_name
  }
  if (authorization.app_client_id !== undefined) {
    resource.app_client_id = authorization.app_client_id
  }
  return resource
}
