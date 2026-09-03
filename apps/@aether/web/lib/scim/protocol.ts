// @aether/web · SCIM 2.0 协议层（RFC 7643/7644）
// 纯函数：错误响应、用户资源映射、ListResponse、filter 解析。
// 不接触 db / auth，全部可单测。

export const SCIM_ERROR_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:Error'
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const SCIM_LIST_RESPONSE_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:ListResponse'
export const SCIM_PATCH_OP_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:PatchOp'

export const SCIM_CONTENT_TYPE = 'application/scim+json'

export function scimJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': SCIM_CONTENT_TYPE,
    },
  })
}

/** RFC 7644 §3.12 错误结构。 */
export function scimError(status: number, detail: string): Response {
  return scimJson(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail,
    },
    status,
  )
}

export interface ScimUserRecord {
  id: string
  name: string
  email: string
  createdAt: Date
  /** 是否在 organization 成员表中（决定 active 语义）。 */
  active: boolean
}

/** 内部用户记录 → SCIM User 资源（RFC 7643 §4.1 / §8.2 约定的核心属性子集）。 */
export function toScimUserResource(
  record: ScimUserRecord,
  baseURL: string,
): Record<string, unknown> {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: record.id,
    userName: record.email,
    name: {
      formatted: record.name,
      familyName: record.name,
      givenName: record.name,
    },
    displayName: record.name,
    active: record.active,
    emails: [
      {
        value: record.email,
        type: 'work',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'User',
      created: record.createdAt.toISOString(),
      location: `${baseURL}/api/scim/v2/Users/${record.id}`,
    },
  }
}

export interface ScimListParams {
  totalResults: number
  startIndex: number
  itemsPerPage: number
  resources: Record<string, unknown>[]
}

export function toListResponse(params: ScimListParams): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: params.totalResults,
    startIndex: params.startIndex,
    itemsPerPage: params.itemsPerPage,
    Resources: params.resources,
  }
}

export interface ScimPagination {
  startIndex: number
  count: number
}

export const SCIM_DEFAULT_COUNT = 100
export const SCIM_MAX_COUNT = 200

/** 解析 startIndex / count 分页参数；非法值回退默认。 */
export function parseScimPagination(
  searchParams: URLSearchParams,
): ScimPagination {
  const rawStart = Number(searchParams.get('startIndex'))
  const rawCount = Number(searchParams.get('count'))
  const startIndex =
    Number.isInteger(rawStart) && rawStart >= 1 ? rawStart : 1
  let count =
    Number.isInteger(rawCount) && rawCount >= 1
      ? Math.min(rawCount, SCIM_MAX_COUNT)
      : SCIM_DEFAULT_COUNT
  if (count > SCIM_MAX_COUNT) count = SCIM_MAX_COUNT
  return { startIndex, count }
}

export type ScimFilter =
  | { kind: 'userName'; value: string }
  | { kind: 'unsupported' }

/**
 * 解析 filter 查询参数。仅支持单个 `userName eq "email"`；
 * 其余（and/or/co/sw 等本版未实现的算子）按协议返回 unsupported，由调用方转 400。
 */
export function parseScimFilter(
  filter: string | null,
): ScimFilter | null {
  if (!filter) return null
  const match = /^\s*userName\s+eq\s+"([^"]*)"\s*$/i.exec(filter)
  if (match?.[1] !== undefined) {
    return { kind: 'userName', value: match[1].toLowerCase() }
  }
  return { kind: 'unsupported' }
}

export interface ScimPatchOperation {
  op: string
  path?: string
  value: unknown
}

/** RFC 7644 §3.5.2 PATCH 体（本版仅消费 op/path/value 三个字段）。 */
export interface ScimPatchBody {
  Operations: ScimPatchOperation[]
}

/**
 * 从 PATCH ops 提取本版支持的字段：active（布尔）与 displayName（字符串）。
 * 返回 null 表示体里有不支持的 op / path → 调用方返回 400。
 */
export function extractPatchChanges(body: unknown): {
  active?: boolean
  displayName?: string
} | null {
  if (typeof body !== 'object' || body === null) return null
  const operations = (body as { Operations?: unknown }).Operations
  if (!Array.isArray(operations) || operations.length === 0) return null

  let active: boolean | undefined
  let displayName: string | undefined

  for (const operation of operations) {
    if (typeof operation !== 'object' || operation === null) return null
    const { op, path, value } = operation as ScimPatchOperation
    const opName = typeof op === 'string' ? op.toLowerCase() : ''
    if (opName !== 'replace') return null

    const targets: Record<string, unknown>[] =
      typeof path === 'string' && path.length > 0
        ? [{ [path]: value }]
        : typeof value === 'object' && value !== null
          ? [value as Record<string, unknown>]
          : []

    for (const target of targets) {
      for (const [key, raw] of Object.entries(target)) {
        const normalized = key.split('.').pop() ?? key
        if (normalized === 'active') {
          const parsed = parseBoolean(raw)
          if (parsed === null) return null
          active = parsed
        } else if (normalized === 'displayName') {
          if (typeof raw !== 'string' || raw.trim().length === 0) return null
          displayName = raw.trim()
        } else {
          return null
        }
      }
    }
  }
  const changes: { active?: boolean; displayName?: string } = {}
  if (active !== undefined) changes.active = active
  if (displayName !== undefined) changes.displayName = displayName
  return changes
}

/** 部分.IdP 会把布尔序列化为字符串；两者都接受，其余视为非法。 */
export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}
