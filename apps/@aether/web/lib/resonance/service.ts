// @aether/web · Resonance Gateway 业务层（/api/v1）
// 职责：API Key 鉴权 → Realm / 资源守卫 → 委托业务核心（core.ts）→ 错误映射。
// 业务规则（状态机 / project 归属 / dialogue 竞争回写 / 审计 / outbox）在
// core.ts 唯一实现（API-First 收口，M3.18）；本层不重复业务逻辑。
// 路由层只透传参数；协议结构（错误体 / 资源映射 / 分页）在 protocol.ts，
// 鉴权在 auth.ts。禁止 import 任何 'use server' 模块（会话耦合）。
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'

import {
  currents,
  dialogueMessages,
  entities,
  projects,
  threads,
} from '@aether/db'
import { getDb } from '@/lib/db'
import {
  coreAppendDialogue,
  coreCreateThread,
  corePatchThread,
  requireThreadRow,
  type CoreActor,
  type CoreErrorCode,
} from './core'
import {
  apiKeyActor,
  authorizeRequest,
  requireRealmMatch,
  type ResolvedApiKey,
} from './auth'
import { isResponse, readJsonBody, runHandler } from './http'
import {
  createDialogueInputSchema,
  createThreadInputSchema,
  notFound,
  parseCursorPagination,
  parseOffsetPagination,
  patchThreadInputSchema,
  THREAD_STATUSES,
  toCursorPaginated,
  toCurrentResource,
  toDialogueMessageResource,
  toEntityResource,
  toOffsetPaginated,
  toProjectResource,
  toRealmResource,
  toThreadResource,
  apiJson,
  apiError,
  zodBadRequest,
  type ThreadStatus,
} from './protocol'

/** CoreError → HTTP：业务核心错误码到 Gateway 错误体的唯一映射。 */
function coreErrorToResponse(error: {
  code: CoreErrorCode
  message: string
}): Response {
  switch (error.code) {
    case 'not_found':
      return notFound()
    case 'invalid_project':
      return apiError(400, 'bad_request', error.message)
    case 'invalid_status_transition':
      return apiError(400, 'invalid_status_transition', error.message)
  }
}

/** API Key 通道的审计归因主体。 */
function apiKeyCoreActor(key: ResolvedApiKey): CoreActor {
  return { ...apiKeyActor(key), source: 'api-key' }
}

// ---- GET /api/v1 ----

export async function handleApiIndex(request: Request): Promise<Response> {
  return runHandler('handleApiIndex', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    return apiJson({
      name: 'aether',
      version: 'v1',
      resources: {
        realms: '/api/v1/realms',
        realm: '/api/v1/realms/{realmId}',
        projects: '/api/v1/realms/{realmId}/projects',
        threads: '/api/v1/realms/{realmId}/threads',
        thread: '/api/v1/threads/{threadId}',
        dialogues: '/api/v1/threads/{threadId}/dialogues',
        entities: '/api/v1/realms/{realmId}/entities',
        currents: '/api/v1/realms/{realmId}/currents',
      },
    })
  })
}

// ---- GET /api/v1/realms ----

export async function handleListRealms(request: Request): Promise<Response> {
  return runHandler('handleListRealms', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    return apiJson({ data: [toRealmResource(context.key.realm)] })
  })
}

// ---- GET /api/v1/realms/{realmId} ----

export async function handleGetRealm(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleGetRealm', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch
    return apiJson(toRealmResource(context.key.realm))
  })
}

// ---- GET /api/v1/realms/{realmId}/projects ----

export async function handleListProjects(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleListProjects', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch

    const rows = await getDb()
      .select({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        default_branch: projects.default_branch,
        created_at: projects.created_at,
      })
      .from(projects)
      .where(eq(projects.realm_id, realmId))
      .orderBy(asc(projects.created_at))
    return apiJson({ data: rows.map((row) => toProjectResource(row)) })
  })
}

// ---- GET /api/v1/realms/{realmId}/threads ----

export async function handleListThreads(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleListThreads', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch

    const url = new URL(request.url)
    const statusParam = url.searchParams.get('status')
    let status: ThreadStatus | undefined
    if (statusParam !== null) {
      if (!THREAD_STATUSES.includes(statusParam as ThreadStatus)) {
        return apiError(
          400,
          'bad_request',
          `Invalid status filter; must be one of: ${THREAD_STATUSES.join(', ')}.`,
        )
      }
      status = statusParam as ThreadStatus
    }
    const pagination = parseOffsetPagination(url.searchParams)

    const db = getDb()
    const where = and(
      eq(threads.realm_id, realmId),
      isNull(threads.deleted_at),
      ...(status !== undefined ? [eq(threads.status, status)] : []),
    )
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(threads)
      .where(where)
    const total = countRow?.total ?? 0
    const rows = await db
      .select({
        id: threads.id,
        realm_id: threads.realm_id,
        project_id: threads.project_id,
        title: threads.title,
        status: threads.status,
        manifestation_url: threads.manifestation_url,
        dialogue_ref: threads.dialogue_ref,
        code_anchor: threads.code_anchor,
        created_at: threads.created_at,
        updated_at: threads.updated_at,
      })
      .from(threads)
      .where(where)
      .orderBy(desc(threads.created_at))
      .limit(pagination.limit)
      .offset(pagination.offset)

    return apiJson(
      toOffsetPaginated(
        rows.map((row) => toThreadResource(row)),
        total,
        pagination,
      ),
    )
  })
}

// ---- POST /api/v1/realms/{realmId}/threads ----

export async function handleCreateThread(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleCreateThread', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch

    const body = await readJsonBody(request)
    if (isResponse(body)) return body
    const parsed = createThreadInputSchema.safeParse(body)
    if (!parsed.success) return zodBadRequest(parsed.error)

    const result = await coreCreateThread(getDb(), {
      realmId,
      projectId: parsed.data.project_id,
      title: parsed.data.title,
      ...(parsed.data.manifestation_url !== undefined
        ? { manifestationUrl: parsed.data.manifestation_url }
        : {}),
      ...(parsed.data.code_anchor !== undefined
        ? { codeAnchor: { selection: parsed.data.code_anchor } }
        : {}),
      actor: apiKeyCoreActor(context.key),
    })
    if (!result.ok) return coreErrorToResponse(result)

    return apiJson(toThreadResource(result.data, { detail: true }), 201)
  })
}

// ---- GET /api/v1/threads/{threadId} ----

export async function handleGetThread(
  request: Request,
  threadId: string,
): Promise<Response> {
  return runHandler('handleGetThread', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context

    const thread = await requireThreadRow(
      getDb(),
      context.key.realm.id,
      threadId,
    )
    if (thread === null) return notFound()
    return apiJson(toThreadResource(thread, { detail: true }))
  })
}

// ---- PATCH /api/v1/threads/{threadId} ----

export async function handlePatchThread(
  request: Request,
  threadId: string,
): Promise<Response> {
  return runHandler('handlePatchThread', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const realmId = context.key.realm.id

    const body = await readJsonBody(request)
    if (isResponse(body)) return body
    const parsed = patchThreadInputSchema.safeParse(body)
    if (!parsed.success) return zodBadRequest(parsed.error)

    const result = await corePatchThread(getDb(), {
      threadId,
      realmId,
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.manifestation_url !== undefined
        ? { manifestationUrl: parsed.data.manifestation_url }
        : {}),
      actor: apiKeyCoreActor(context.key),
    })
    if (!result.ok) return coreErrorToResponse(result)

    return apiJson(toThreadResource(result.data, { detail: true }))
  })
}

// ---- GET /api/v1/threads/{threadId}/dialogues ----

export async function handleListDialogues(
  request: Request,
  threadId: string,
): Promise<Response> {
  return runHandler('handleListDialogues', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context

    const thread = await requireThreadRow(
      getDb(),
      context.key.realm.id,
      threadId,
    )
    if (thread === null) return notFound()

    const pagination = parseCursorPagination(new URL(request.url).searchParams)
    if (pagination === null) {
      return apiError(
        400,
        'bad_request',
        'after and limit must be non-negative integers.',
      )
    }

    if (thread.dialogue_ref === null) {
      return apiJson({
        data: [],
        pagination: { next_after: null, limit: pagination.limit },
      })
    }

    const rows = await getDb()
      .select({
        id: dialogueMessages.id,
        seq: dialogueMessages.seq,
        role: dialogueMessages.role,
        content: dialogueMessages.content,
        actor_type: dialogueMessages.actor_type,
        actor_id: dialogueMessages.actor_id,
        metadata: dialogueMessages.metadata,
        created_at: dialogueMessages.created_at,
      })
      .from(dialogueMessages)
      .where(
        and(
          eq(dialogueMessages.realm_id, context.key.realm.id),
          eq(dialogueMessages.dialogue_id, thread.dialogue_ref),
          ...(pagination.after !== null
            ? [gt(dialogueMessages.seq, pagination.after)]
            : []),
        ),
      )
      .orderBy(asc(dialogueMessages.seq))
      .limit(pagination.limit)

    return apiJson({
      data: rows.map((row) => toDialogueMessageResource(row)),
      pagination: toCursorPaginated(rows, (row) => row.seq, pagination)
        .pagination,
    })
  })
}

// ---- POST /api/v1/threads/{threadId}/dialogues ----

export async function handleCreateDialogue(
  request: Request,
  threadId: string,
): Promise<Response> {
  return runHandler('handleCreateDialogue', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const realmId = context.key.realm.id

    const body = await readJsonBody(request)
    if (isResponse(body)) return body
    const parsed = createDialogueInputSchema.safeParse(body)
    if (!parsed.success) return zodBadRequest(parsed.error)

    const result = await coreAppendDialogue(getDb(), {
      threadId,
      realmId,
      role: parsed.data.role,
      content: parsed.data.content,
      actor: apiKeyCoreActor(context.key),
      // 消息归因密钥创建者（human），审计归因密钥本身（entity）
      messageActor: { actorType: 'human', actorId: context.key.creatorId },
      metadata: {
        via: 'api-key',
        key_id: context.key.keyId,
        key_name: context.key.keyName,
      },
    })
    if (!result.ok) return coreErrorToResponse(result)

    return apiJson(toDialogueMessageResource(result.data.message), 201)
  })
}

// ---- GET /api/v1/realms/{realmId}/entities ----

export async function handleListEntities(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleListEntities', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch

    const rows = await getDb()
      .select({
        id: entities.id,
        display_name: entities.display_name,
        status: entities.status,
        created_at: entities.created_at,
        updated_at: entities.updated_at,
      })
      .from(entities)
      .where(eq(entities.realm_id, realmId))
      .orderBy(asc(entities.created_at))
    return apiJson({ data: rows.map((row) => toEntityResource(row)) })
  })
}

// ---- GET /api/v1/realms/{realmId}/currents ----

export async function handleListCurrents(
  request: Request,
  realmId: string,
): Promise<Response> {
  return runHandler('handleListCurrents', async () => {
    const context = await authorizeRequest(request)
    if (isResponse(context)) return context
    const mismatch = requireRealmMatch(context, realmId)
    if (mismatch) return mismatch

    const rows = await getDb()
      .select({
        id: currents.id,
        doc_ref: currents.doc_ref,
        connection_state: currents.connection_state,
        presence_snapshot: currents.presence_snapshot,
        last_converge_at: currents.last_converge_at,
        updated_at: currents.updated_at,
      })
      .from(currents)
      .where(eq(currents.realm_id, realmId))
      .orderBy(desc(currents.updated_at))
    return apiJson({ data: rows.map((row) => toCurrentResource(row)) })
  })
}
