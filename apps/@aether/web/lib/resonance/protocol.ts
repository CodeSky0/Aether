// @aether/web · Resonance Gateway 协议层（/api/v1）
// 纯函数：错误响应、资源映射、分页解析、输入校验、Thread 状态机。
// 不接触 db / auth，全部可单测（沿 SCIM protocol.ts 范式）。

import { z } from 'zod'

export const API_CONTENT_TYPE = 'application/json'

// ---- 响应构造 ----

export function apiJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': API_CONTENT_TYPE },
  })
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'bad_request'
  | 'invalid_json'
  | 'invalid_status_transition'
  | 'service_unavailable'
  | 'internal_error'

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
): Response {
  return apiJson({ error: { code, message } }, status)
}

export function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'unauthorized', message: 'Invalid or missing API key.' },
    }),
    {
      status: 401,
      headers: {
        'content-type': API_CONTENT_TYPE,
        'www-authenticate': 'Bearer',
      },
    },
  )
}

export function notFound(): Response {
  return apiError(404, 'not_found', 'Resource not found.')
}

export function badRequest(message: string): Response {
  return apiError(400, 'bad_request', message)
}

// ---- 分页 ----

export const DEFAULT_LIMIT = 30
export const MAX_LIMIT = 100

export interface OffsetPagination {
  limit: number
  offset: number
}

/** 解析 limit / offset 查询参数：非法值回退默认，limit 服务端 clamp。 */
export function parseOffsetPagination(params: URLSearchParams): OffsetPagination {
  const rawLimit = Number.parseInt(params.get('limit') ?? '', 10)
  const rawOffset = Number.parseInt(params.get('offset') ?? '', 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return { limit, offset }
}

export interface OffsetPaginated<T> {
  data: T[]
  pagination: { total: number; limit: number; offset: number }
}

export function toOffsetPaginated<T>(
  rows: T[],
  total: number,
  pagination: OffsetPagination,
): OffsetPaginated<T> {
  return {
    data: rows,
    pagination: { total, limit: pagination.limit, offset: pagination.offset },
  }
}

// ---- 游标分页（dialogue 消息，seq 单调递增） ----

export const DIALOGUE_DEFAULT_LIMIT = 50
export const DIALOGUE_MAX_LIMIT = 200

export interface CursorPagination {
  limit: number
  /** 仅返回 seq 严格大于该值的消息；缺省从头开始。 */
  after: number | null
}

/**
 * 解析 after / limit 查询参数。after / limit 为非正数或非数字 → null（交给
 * 调用方 400）；limit 服务端 clamp 到 [1, DIALOGUE_MAX_LIMIT]。
 */
export function parseCursorPagination(
  params: URLSearchParams,
): CursorPagination | null {
  const afterRaw = params.get('after')
  let after: number | null = null
  if (afterRaw !== null) {
    after = Number.parseInt(afterRaw, 10)
    if (!Number.isFinite(after) || after < 0) return null
  }
  const limitRaw = params.get('limit')
  let limit = DIALOGUE_DEFAULT_LIMIT
  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10)
    if (!Number.isFinite(parsed) || parsed < 1) return null
    limit = Math.min(parsed, DIALOGUE_MAX_LIMIT)
  }
  return { limit, after }
}

export interface CursorPaginated<T> {
  data: T[]
  pagination: { next_after: number | null; limit: number }
}

/** next_after：未取满一页即已到尾（null）；否则最后一行的 seq。 */
export function toCursorPaginated<T>(
  rows: T[],
  lastSeq: (row: T) => number,
  pagination: CursorPagination,
): CursorPaginated<T> {
  const next_after =
    rows.length === pagination.limit && rows.length > 0
      ? lastSeq(rows[rows.length - 1] as T)
      : null
  return { data: rows, pagination: { next_after, limit: pagination.limit } }
}

/** zod 校验失败 → 400 响应（字段级提示）。 */
export function zodBadRequest(error: z.ZodError): Response {
  const message = error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ')
  return badRequest(message)
}

// ---- Thread 状态机 ----

export const THREAD_STATUSES = [
  'open',
  'in_review',
  'resolved',
  'archived',
] as const
export type ThreadStatus = (typeof THREAD_STATUSES)[number]

const THREAD_TRANSITIONS: Record<ThreadStatus, readonly ThreadStatus[]> = {
  open: ['in_review', 'resolved'],
  in_review: ['open', 'resolved'],
  resolved: ['archived', 'open'],
  archived: ['open'],
}

/** 非法迁移返回 false；同值迁移视为 no-op 合法。 */
export function isThreadStatusTransitionAllowed(
  from: ThreadStatus,
  to: ThreadStatus,
): boolean {
  if (from === to) return true
  return THREAD_TRANSITIONS[from].includes(to)
}

// ---- 输入 schema ----

export const createThreadInputSchema = z.object({
  project_id: z.uuid('project_id 必须是合法 UUID'),
  title: z.string().trim().min(1, 'title 不能为空').max(200, 'title 最长 200 字符'),
  manifestation_url: z.url('manifestation_url 必须是合法 URL').optional(),
  code_anchor: z.string().max(10_000, 'code_anchor 最长 10000 字符').optional(),
})
export type CreateThreadInput = z.infer<typeof createThreadInputSchema>

/**
 * PATCH：status / manifestation_url 均可缺省（缺省即不变）；
 * manifestation_url 为 null 表示解绑（区别于 undefined 不动）。
 */
export const patchThreadInputSchema = z
  .object({
    status: z.enum(THREAD_STATUSES).optional(),
    manifestation_url: z
      .url('manifestation_url 必须是合法 URL')
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.manifestation_url !== undefined,
    { message: '至少提供 status 或 manifestation_url 之一' },
  )
export type PatchThreadInput = z.infer<typeof patchThreadInputSchema>

export const createDialogueInputSchema = z.object({
  role: z.enum(['user', 'assistant']).default('user'),
  content: z
    .string()
    .trim()
    .min(1, 'content 不能为空')
    .max(20_000, 'content 最长 20000 字符'),
})
export type CreateDialogueInput = z.infer<typeof createDialogueInputSchema>

// ---- 资源映射（DB 行 → 公开 JSON，snake_case，ISO 时间戳） ----

function iso(value: Date): string {
  return value.toISOString()
}

export interface RealmRecord {
  id: string
  slug: string
  name: string
  created_at: Date
  updated_at: Date
}

export function toRealmResource(realm: RealmRecord): Record<string, unknown> {
  return {
    id: realm.id,
    slug: realm.slug,
    name: realm.name,
    created_at: iso(realm.created_at),
    updated_at: iso(realm.updated_at),
  }
}

export interface ProjectRecord {
  id: string
  slug: string
  name: string
  default_branch: string
  created_at: Date
}

export function toProjectResource(
  project: ProjectRecord,
): Record<string, unknown> {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    default_branch: project.default_branch,
    created_at: iso(project.created_at),
  }
}

export interface ThreadRecord {
  id: string
  realm_id: string
  project_id: string
  title: string
  status: ThreadStatus
  manifestation_url: string | null
  dialogue_ref: string | null
  code_anchor: unknown
  created_at: Date
  updated_at: Date
}

/** detail=false：列表视图省略 code_anchor（可能为大体积选区内容）。 */
export function toThreadResource(
  thread: ThreadRecord,
  options?: { detail?: boolean },
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    id: thread.id,
    realm_id: thread.realm_id,
    project_id: thread.project_id,
    title: thread.title,
    status: thread.status,
    created_at: iso(thread.created_at),
    updated_at: iso(thread.updated_at),
  }
  if (thread.manifestation_url !== null) {
    resource.manifestation_url = thread.manifestation_url
  }
  if (thread.dialogue_ref !== null) {
    resource.dialogue_ref = thread.dialogue_ref
  }
  if (options?.detail === true) {
    resource.code_anchor = thread.code_anchor
  }
  return resource
}

export interface EntityRecord {
  id: string
  display_name: string
  status: string
  created_at: Date
  updated_at: Date
}

export function toEntityResource(
  entity: EntityRecord,
): Record<string, unknown> {
  return {
    id: entity.id,
    display_name: entity.display_name,
    status: entity.status,
    created_at: iso(entity.created_at),
    updated_at: iso(entity.updated_at),
  }
}

export interface CurrentRecord {
  id: string
  doc_ref: string
  connection_state: string
  presence_snapshot: unknown
  last_converge_at: Date | null
  updated_at: Date
}

export function toCurrentResource(
  current: CurrentRecord,
): Record<string, unknown> {
  return {
    id: current.id,
    doc_ref: current.doc_ref,
    connection_state: current.connection_state,
    presence_snapshot: current.presence_snapshot,
    ...(current.last_converge_at !== null
      ? { last_converge_at: iso(current.last_converge_at) }
      : {}),
    updated_at: iso(current.updated_at),
  }
}

export interface DialogueMessageRecord {
  id: string
  seq: number
  role: string
  content: string
  actor_type: string
  actor_id: string
  metadata: unknown
  created_at: Date
}

export function toDialogueMessageResource(
  message: DialogueMessageRecord,
): Record<string, unknown> {
  return {
    id: message.id,
    seq: message.seq,
    role: message.role,
    content: message.content,
    actor_type: message.actor_type,
    actor_id: message.actor_id,
    metadata: message.metadata,
    created_at: iso(message.created_at),
  }
}
