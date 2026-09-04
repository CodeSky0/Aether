// Resonance Gateway 协议层纯函数测试（lib/resonance/protocol.ts）
import { describe, expect, it } from 'vitest'

import {
  apiError,
  createDialogueInputSchema,
  createThreadInputSchema,
  isThreadStatusTransitionAllowed,
  parseCursorPagination,
  parseOffsetPagination,
  patchThreadInputSchema,
  toCursorPaginated,
  toCurrentResource,
  toDialogueMessageResource,
  toThreadResource,
  unauthorized,
} from '@/lib/resonance/protocol'

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries)
}

describe('响应构造', () => {
  it('apiError 携带 code / message 与状态码', async () => {
    const response = apiError(404, 'not_found', 'Resource not found.')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: 'Resource not found.' },
    })
  })

  it('unauthorized 附带 WWW-Authenticate: Bearer', () => {
    const response = unauthorized()
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
  })
})

describe('parseOffsetPagination', () => {
  it('缺省回退默认值（limit 30 / offset 0）', () => {
    expect(parseOffsetPagination(params({}))).toEqual({ limit: 30, offset: 0 })
  })

  it('limit 服务端 clamp 到 100；非法值回退默认', () => {
    expect(parseOffsetPagination(params({ limit: '500' }))).toEqual({
      limit: 100,
      offset: 0,
    })
    expect(parseOffsetPagination(params({ limit: 'abc', offset: '-5' }))).toEqual(
      { limit: 30, offset: 0 },
    )
  })

  it('合法 limit / offset 原样保留', () => {
    expect(parseOffsetPagination(params({ limit: '10', offset: '20' }))).toEqual({
      limit: 10,
      offset: 20,
    })
  })
})

describe('parseCursorPagination', () => {
  it('缺省：limit 50 / after null', () => {
    expect(parseCursorPagination(params({}))).toEqual({
      limit: 50,
      after: null,
    })
  })

  it('limit clamp 到 200', () => {
    expect(parseCursorPagination(params({ limit: '999' }))).toEqual({
      limit: 200,
      after: null,
    })
  })

  it('非法 after / limit 返回 null（调用方 400）', () => {
    expect(parseCursorPagination(params({ after: 'x' }))).toBeNull()
    expect(parseCursorPagination(params({ after: '-1' }))).toBeNull()
    expect(parseCursorPagination(params({ limit: '0' }))).toBeNull()
  })

  it('合法 after 保留', () => {
    expect(parseCursorPagination(params({ after: '42', limit: '7' }))).toEqual({
      limit: 7,
      after: 42,
    })
  })
})

describe('toCursorPaginated', () => {
  it('取满一页时 next_after 为最后一行 seq', () => {
    const rows = [{ seq: 1 }, { seq: 2 }]
    expect(
      toCursorPaginated(rows, (row) => row.seq, { limit: 2, after: null }),
    ).toEqual({
      data: rows,
      pagination: { next_after: 2, limit: 2 },
    })
  })

  it('未取满一页时 next_after 为 null', () => {
    const rows = [{ seq: 1 }]
    expect(
      toCursorPaginated(rows, (row) => row.seq, { limit: 5, after: null })
        .pagination,
    ).toEqual({ next_after: null, limit: 5 })
  })
})

describe('Thread 状态机', () => {
  it('同值迁移为合法 no-op', () => {
    expect(isThreadStatusTransitionAllowed('open', 'open')).toBe(true)
  })

  it('合法迁移矩阵', () => {
    expect(isThreadStatusTransitionAllowed('open', 'in_review')).toBe(true)
    expect(isThreadStatusTransitionAllowed('open', 'resolved')).toBe(true)
    expect(isThreadStatusTransitionAllowed('in_review', 'open')).toBe(true)
    expect(isThreadStatusTransitionAllowed('resolved', 'archived')).toBe(true)
    expect(isThreadStatusTransitionAllowed('resolved', 'open')).toBe(true)
    expect(isThreadStatusTransitionAllowed('archived', 'open')).toBe(true)
  })

  it('非法迁移', () => {
    expect(isThreadStatusTransitionAllowed('open', 'archived')).toBe(false)
    expect(isThreadStatusTransitionAllowed('archived', 'resolved')).toBe(false)
    expect(isThreadStatusTransitionAllowed('archived', 'in_review')).toBe(false)
    expect(isThreadStatusTransitionAllowed('in_review', 'archived')).toBe(false)
  })
})

describe('输入 schema', () => {
  it('createThreadInput：合法输入通过', () => {
    const parsed = createThreadInputSchema.safeParse({
      project_id: '123e4567-e89b-12d3-a456-426614174000',
      title: ' 修复登录跳转 ',
      manifestation_url: 'https://example.com/preview',
      code_anchor: 'const x = 1',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.title).toBe('修复登录跳转')
  })

  it('createThreadInput：title 空 / 超长 / 坏 URL 拒绝', () => {
    expect(
      createThreadInputSchema.safeParse({
        project_id: '123e4567-e89b-12d3-a456-426614174000',
        title: '  ',
      }).success,
    ).toBe(false)
    expect(
      createThreadInputSchema.safeParse({
        project_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'x'.repeat(201),
      }).success,
    ).toBe(false)
    expect(
      createThreadInputSchema.safeParse({
        project_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 't',
        manifestation_url: 'not-a-url',
      }).success,
    ).toBe(false)
  })

  it('patchThreadInput：两者都缺省拒绝；null 表示解绑', () => {
    expect(patchThreadInputSchema.safeParse({}).success).toBe(false)
    const parsed = patchThreadInputSchema.safeParse({
      manifestation_url: null,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.manifestation_url).toBeNull()
  })

  it('createDialogueInput：role 缺省 user；非法 role / 空 content 拒绝', () => {
    const parsed = createDialogueInputSchema.safeParse({ content: 'hello' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.role).toBe('user')
    expect(
      createDialogueInputSchema.safeParse({ role: 'system', content: 'x' })
        .success,
    ).toBe(false)
    expect(
      createDialogueInputSchema.safeParse({ content: '   ' }).success,
    ).toBe(false)
  })
})

describe('资源映射', () => {
  const now = new Date('2026-09-01T00:00:00.000Z')

  it('toThreadResource：列表视图省略 code_anchor，detail 视图包含', () => {
    const thread = {
      id: 't1',
      realm_id: 'r1',
      project_id: 'p1',
      title: '标题',
      status: 'open' as const,
      manifestation_url: 'https://example.com',
      dialogue_ref: 'd1',
      code_anchor: { selection: 'abc' },
      created_at: now,
      updated_at: now,
    }
    const listResource = toThreadResource(thread)
    expect(listResource).not.toHaveProperty('code_anchor')
    expect(listResource.manifestation_url).toBe('https://example.com')

    const detailResource = toThreadResource(thread, { detail: true })
    expect(detailResource.code_anchor).toEqual({ selection: 'abc' })
    expect(detailResource.created_at).toBe('2026-09-01T00:00:00.000Z')
  })

  it('toThreadResource：可空字段为 null 时不输出该键', () => {
    const resource = toThreadResource({
      id: 't1',
      realm_id: 'r1',
      project_id: 'p1',
      title: '标题',
      status: 'open',
      manifestation_url: null,
      dialogue_ref: null,
      code_anchor: {},
      created_at: now,
      updated_at: now,
    })
    expect(resource).not.toHaveProperty('manifestation_url')
    expect(resource).not.toHaveProperty('dialogue_ref')
  })

  it('toCurrentResource：last_converge_at 为 null 时省略', () => {
    const resource = toCurrentResource({
      id: 'c1',
      doc_ref: 'realm:r1:main',
      connection_state: 'active',
      presence_snapshot: {},
      last_converge_at: null,
      updated_at: now,
    })
    expect(resource).not.toHaveProperty('last_converge_at')

    const withConverge = toCurrentResource({
      id: 'c1',
      doc_ref: 'realm:r1:main',
      connection_state: 'active',
      presence_snapshot: {},
      last_converge_at: now,
      updated_at: now,
    })
    expect(withConverge.last_converge_at).toBe('2026-09-01T00:00:00.000Z')
  })

  it('toDialogueMessageResource：字段完整、seq 为数值', () => {
    const resource = toDialogueMessageResource({
      id: 'm1',
      seq: 3,
      role: 'user',
      content: 'hi',
      actor_type: 'human',
      actor_id: 'user-1',
      metadata: { via: 'api-key' },
      created_at: now,
    })
    expect(resource.seq).toBe(3)
    expect(resource.metadata).toEqual({ via: 'api-key' })
  })
})
