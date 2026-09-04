// GitHub 集成通道测试（lib/github-webhook.ts → core.ts，M3.18 API-First 收口）
// 覆盖五路径全部走业务核心：issue 创建（审计 entity github 主体 + 事件 + issue anchor）、
// issue closed（状态机迁移 + 事件）、closed 打在 archived Thread 上（容忍忽略）、
// issue_comment（消息归因 GitHub 用户 + dialogue_ref 竞争回写 + 事件）、
// pull_request（manifestation 绑定 + 审计、非状态迁移不发射事件）。
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/audit-write', () => ({
  recordAuditEntry: vi.fn(),
}))

vi.mock('@/lib/webhooks/service', () => ({
  enqueueWebhookDeliveries: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { recordAuditEntry } from '@/lib/audit-write'
import { enqueueWebhookDeliveries } from '@/lib/webhooks/service'
import { handleGithubEvent } from '@/lib/github-webhook'

const mockedRecordAuditEntry = vi.mocked(recordAuditEntry)
const mockedEnqueue = vi.mocked(enqueueWebhookDeliveries)

const REALM_ID = '123e4567-e89b-12d3-a456-426614174000'
const PROJECT_ID = '223e4567-e89b-12d3-a456-426614174001'
const INSTALLATION_ID = '998877'
const THREAD_ID = '323e4567-e89b-12d3-a456-426614174002'
const NOW = new Date('2026-09-01T00:00:00.000Z')

function makeChain(rows: unknown[]): Record<string, unknown> {
  const promise = Promise.resolve(rows)
  const self: Record<string, unknown> = {
    limit: () => self,
    offset: () => self,
    orderBy: () => self,
    where: () => self,
    returning: () => self,
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  }
  return self
}

interface MockDb {
  /** db 句柄（结构化 mock，调用点直接注入 handleGithubEvent）。 */
  db: never
  /** db.update / tx.update 的 set() 补丁（按序）。 */
  updatePatches: Array<Record<string, unknown>>
  /** tx.insert().values() 载荷（按序）。 */
  insertValues: unknown[]
}

interface MockDbConfig {
  selectResults: unknown[][]
  updateResults?: unknown[][]
  insertResults?: unknown[][]
}

function mockDb(config: MockDbConfig): MockDb {
  const selectQueue = [...config.selectResults]
  const updateQueue = [...(config.updateResults ?? [])]
  const insertQueue = [...(config.insertResults ?? [])]
  const updatePatches: Array<Record<string, unknown>> = []
  const insertValues: unknown[] = []

  const updateWith = () =>
    vi.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        updatePatches.push(patch)
        return makeChain(updateQueue.shift() ?? [])
      },
    }))

  const tx = {
    insert: vi.fn(() => ({
      values: (value: unknown) => {
        insertValues.push(value)
        return makeChain(insertQueue.shift() ?? [])
      },
    })),
    update: updateWith(),
  }
  const db = {
    select: vi.fn(() => ({ from: () => makeChain(selectQueue.shift() ?? []) })),
    update: updateWith(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  }
  return { db: db as never, updatePatches, insertValues }
}

function integrationRow(): Record<string, unknown> {
  return { id: 'int-1', realm_id: REALM_ID, repo_full_name: 'octocat/aether' }
}

function threadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: THREAD_ID,
    realm_id: REALM_ID,
    project_id: PROJECT_ID,
    title: 'issue thread',
    status: 'open',
    manifestation_url: null,
    dialogue_ref: null,
    code_anchor: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function issuesPayload(action: string): Record<string, unknown> {
  return {
    action,
    issue: {
      id: 4242,
      number: 7,
      title: 'Bug: 编辑器崩溃',
      html_url: 'https://github.com/octocat/aether/issues/7',
      state: action === 'closed' ? 'closed' : 'open',
    },
    repository: { full_name: 'octocat/aether' },
    installation: { id: Number(INSTALLATION_ID) },
  }
}

function commentPayload(): Record<string, unknown> {
  return {
    action: 'created',
    comment: {
      body: '复现步骤见上',
      html_url: 'https://github.com/octocat/aether/issues/7#issuecomment-1',
      user: { login: 'octocat' },
    },
    issue: {
      id: 4242,
      number: 7,
      title: 'Bug: 编辑器崩溃',
      html_url: 'https://github.com/octocat/aether/issues/7',
      state: 'open',
    },
    repository: { full_name: 'octocat/aether' },
    installation: { id: Number(INSTALLATION_ID) },
  }
}

function prPayload(): Record<string, unknown> {
  return {
    action: 'opened',
    pull_request: {
      number: 7,
      title: 'fix: crash',
      html_url: 'https://github.com/octocat/aether/pull/7',
      draft: false,
    },
    repository: { full_name: 'octocat/aether' },
    installation: { id: Number(INSTALLATION_ID) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRecordAuditEntry.mockResolvedValue()
  mockedEnqueue.mockResolvedValue()
})

describe('handleGithubEvent（集成通道消费 core）', () => {
  it('issues.opened（无关联 Thread）→ coreCreateThread：审计 entity 主体 + 事件 + issue anchor', async () => {
    const mock = mockDb({
      selectResults: [
        [integrationRow()],   // findIntegration
        [],                   // findThreadByIssueId（不存在）
        [{ id: PROJECT_ID }], // findDefaultProject
        [{ id: PROJECT_ID }], // core project 归属校验
      ],
      insertResults: [[threadRow({ id: 'created-1', title: 'Bug: 编辑器崩溃' })]],
    })

    const result = await handleGithubEvent({
      db: mock.db,
      event: 'issues',
      payload: issuesPayload('opened'),
    })

    expect(result.status).toBe('processed')
    expect(result.reason).toContain('created-1')

    // code_anchor 保留 GitHub issue anchor
    expect(mock.insertValues[0]).toMatchObject({
      realm_id: REALM_ID,
      project_id: PROJECT_ID,
      title: 'Bug: 编辑器崩溃',
      code_anchor: {
        source: 'github',
        issueId: 4242,
        issueNumber: 7,
      },
    })

    // 审计：entity github 主体 + source=github
    const auditInput = mockedRecordAuditEntry.mock.calls[0]?.[1]
    expect(auditInput?.actor).toEqual({
      actorType: 'entity',
      actorId: `github:${INSTALLATION_ID}`,
    })
    expect(auditInput?.target).toMatchObject({ kind: 'thread', source: 'github' })
    expect(auditInput?.idempotencyKey).toBe('github:thread.create:created-1')

    expect(mockedEnqueue).toHaveBeenCalledWith(expect.anything(), {
      realmId: REALM_ID,
      eventType: 'thread.created',
      data: {
        thread_id: 'created-1',
        project_id: PROJECT_ID,
        title: 'Bug: 编辑器崩溃',
      },
    })
  })

  it('issues.closed（open Thread）→ corePatchThread：状态机迁移 resolved + 事件', async () => {
    const mock = mockDb({
      selectResults: [
        [integrationRow()],           // findIntegration
        [{ id: THREAD_ID, dialogue_ref: null }], // findThreadByIssueId
        [threadRow()],                // core requireThreadRow
      ],
      updateResults: [[threadRow({ status: 'resolved' })]],
    })

    const result = await handleGithubEvent({
      db: mock.db,
      event: 'issues',
      payload: issuesPayload('closed'),
    })

    expect(result.status).toBe('processed')
    expect(result.reason).toContain('resolved')

    // 审计 + 状态迁移事件
    const auditInput = mockedRecordAuditEntry.mock.calls[0]?.[1]
    expect(auditInput?.action).toBe('write')
    expect(auditInput?.actor).toEqual({
      actorType: 'entity',
      actorId: `github:${INSTALLATION_ID}`,
    })
    expect(auditInput?.idempotencyKey).toContain(`github:thread.update:${THREAD_ID}`)

    expect(mockedEnqueue).toHaveBeenCalledWith(expect.anything(), {
      realmId: REALM_ID,
      eventType: 'thread.status_changed',
      data: { thread_id: THREAD_ID, from: 'open', to: 'resolved' },
    })
  })

  it('issues.closed（archived Thread）→ 状态机拒绝，容忍忽略（人工归档优先）', async () => {
    const mock = mockDb({
      selectResults: [
        [integrationRow()],           // findIntegration
        [{ id: THREAD_ID, dialogue_ref: null }], // findThreadByIssueId
        [threadRow({ status: 'archived' })],     // core requireThreadRow
      ],
    })

    const result = await handleGithubEvent({
      db: mock.db,
      event: 'issues',
      payload: issuesPayload('closed'),
    })

    // 状态机 archived → resolved 非法：忽略而非崩溃，无写库 / 审计 / 事件
    expect(result.status).toBe('ignored')
    expect(result.reason).toContain('archived')
    expect(mock.updatePatches).toHaveLength(0)
    expect(mockedRecordAuditEntry).not.toHaveBeenCalled()
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('issue_comment.created（无 dialogue_ref）→ 消息归因 GitHub 用户 + 竞争回写 + 事件', async () => {
    const mock = mockDb({
      selectResults: [
        [integrationRow()],           // findIntegration
        [{ id: THREAD_ID, dialogue_ref: null }], // findThreadByIssueId
        [threadRow({ dialogue_ref: null })],     // core requireThreadRow
      ],
      updateResults: [
        [{ dialogue_ref: 'd-claimed' }], // dialogue_ref 竞争回写
        [],                              // touch updated_at
      ],
      insertResults: [[
        {
          id: 'msg-1',
          seq: 1,
          role: 'user',
          content: '复现步骤见上',
          actor_type: 'human',
          actor_id: 'octocat',
          metadata: {},
          created_at: NOW,
        },
      ]],
    })

    const result = await handleGithubEvent({
      db: mock.db,
      event: 'issue_comment',
      payload: commentPayload(),
    })

    expect(result.status).toBe('processed')

    // 消息：归因 GitHub 评论者 + metadata 保留 GitHub 来源
    expect(mock.insertValues[0]).toMatchObject({
      realm_id: REALM_ID,
      dialogue_id: 'd-claimed',
      actor_type: 'human',
      actor_id: 'octocat',
      role: 'user',
      metadata: {
        source: 'github',
        issueNumber: 7,
      },
    })

    // 审计：entity github 主体，action=converse
    const auditInput = mockedRecordAuditEntry.mock.calls[0]?.[1]
    expect(auditInput?.action).toBe('converse')
    expect(auditInput?.actor).toEqual({
      actorType: 'entity',
      actorId: `github:${INSTALLATION_ID}`,
    })

    const enqueueInput = mockedEnqueue.mock.calls[0]?.[1]
    expect(enqueueInput?.eventType).toBe('dialogue.message_created')
    expect(enqueueInput?.data).toMatchObject({
      thread_id: THREAD_ID,
      dialogue_id: 'd-claimed',
      message_id: 'msg-1',
    })
  })

  it('pull_request.opened（issue 关联 Thread）→ manifestation 绑定 + 审计、不发射事件', async () => {
    const mock = mockDb({
      selectResults: [
        [integrationRow()],  // findIntegration
        [{ id: THREAD_ID }], // PR issueNumber 关联查找
        [threadRow()],       // core requireThreadRow
      ],
      updateResults: [[threadRow({ manifestation_url: 'https://github.com/octocat/aether/pull/7' })]],
    })

    const result = await handleGithubEvent({
      db: mock.db,
      event: 'pull_request',
      payload: prPayload(),
    })

    expect(result.status).toBe('processed')

    // manifestation 绑定写库 + 审计
    expect(mock.updatePatches[0]).toMatchObject({
      manifestation_url: 'https://github.com/octocat/aether/pull/7',
    })
    const auditInput = mockedRecordAuditEntry.mock.calls[0]?.[1]
    expect(auditInput?.action).toBe('write')
    expect(auditInput?.target).toMatchObject({
      kind: 'thread',
      thread_id: THREAD_ID,
      source: 'github',
    })
    // 非状态迁移：不发射 webhook 事件
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('无 installation_id / 无集成 → ignored（不触库业务层）', async () => {
    const mock = mockDb({
      selectResults: [[integrationRow()], []], // findIntegration 未命中
    })

    const noInstall = await handleGithubEvent({
      db: mock.db,
      event: 'issues',
      payload: { action: 'opened' }, // 无 installation
    })
    expect(noInstall).toEqual({ status: 'ignored', reason: 'no installation_id' })

    const noIntegration = await handleGithubEvent({
      db: mock.db,
      event: 'issues',
      payload: issuesPayload('opened'),
    })
    expect(noIntegration.status).toBe('ignored')
    expect(mockedRecordAuditEntry).not.toHaveBeenCalled()
  })
})
