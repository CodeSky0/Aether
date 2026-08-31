// @aether/web · GitHub Webhook 事件映射（Resonance Bridge）
// 将 GitHub 事件映射到 Aether 领域对象：
//   Issue ↔ Thread        （code_anchor 存 githubIssueId 做关联键）
//   PR   ↔ Manifestation  （thread.manifestation_url = PR preview URL）
//   issue_comment → dialogue message（追加到 Thread 对话历史）
// installation_id 反查 realm_integrations 定位 Realm；project 取该 Realm 首个 project。
import { threads, projects, dialogueMessages, realmIntegrations } from '@aether/db'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { createLogger } from '@/lib/logger'

const logger = createLogger('github-webhook')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any>

export interface GithubWebhookContext {
  db: Db
  event: string
  payload: unknown
}

export interface GithubWebhookResult {
  status: 'ignored' | 'processed' | 'error'
  reason?: string
}

/** installation_id → Realm integration 反查。 */
async function findIntegration(db: Db, installationId: string) {
  const [row] = await db
    .select({
      id: realmIntegrations.id,
      realm_id: realmIntegrations.realm_id,
      repo_full_name: realmIntegrations.repo_full_name,
      config: realmIntegrations.config,
    })
    .from(realmIntegrations)
    .where(
      and(
        eq(realmIntegrations.provider, 'github'),
        eq(realmIntegrations.installation_id, installationId),
        isNull(realmIntegrations.deleted_at),
      ),
    )
    .limit(1)
  return row ?? null
}

/** 取 Realm 首个 project 作为 Thread 落点；无 project 则返回 null。 */
async function findDefaultProject(db: Db, realmId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.realm_id, realmId))
    .orderBy(asc(projects.id))
    .limit(1)
  return row ?? null
}

/** 按 GitHub issue id 查找已关联的 Thread。 */
async function findThreadByIssueId(db: Db, realmId: string, issueId: number) {
  const [row] = await db
    .select({ id: threads.id, dialogue_ref: threads.dialogue_ref })
    .from(threads)
    .where(
      and(
        eq(threads.realm_id, realmId),
        isNull(threads.deleted_at),
        sql`${threads.code_anchor}->>'githubIssueId' = ${String(issueId)}`,
      ),
    )
    .limit(1)
  return row ?? null
}

function githubIssueAnchor(issue: GithubIssue, repoFullName: string) {
  return {
    source: 'github',
    provider: 'github',
    repo: repoFullName,
    issueNumber: issue.number,
    issueId: issue.id,
    issueUrl: issue.html_url,
  }
}

// ---- GitHub webhook payload 类型（仅取用到的字段）----
interface GithubIssue {
  id: number
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
}
interface GithubRepository {
  full_name: string
}
interface GithubInstallation {
  id: number
}
interface IssuesPayload {
  action: string
  issue: GithubIssue
  repository: GithubRepository
  installation?: GithubInstallation
}
interface IssueCommentPayload {
  action: string
  comment: { body: string; html_url: string; user?: { login: string } }
  issue: GithubIssue
  repository: GithubRepository
  installation?: GithubInstallation
}
interface PullRequestPayload {
  action: string
  pull_request: { number: number; title: string; html_url: string; draft: boolean }
  repository: GithubRepository
  installation?: GithubInstallation
}

/** 事件分发入口。 */
export async function handleGithubEvent(
  ctx: GithubWebhookContext,
): Promise<GithubWebhookResult> {
  const { db, event, payload } = ctx
  const installationId = extractInstallationId(event, payload)
  if (!installationId) {
    return { status: 'ignored', reason: 'no installation_id' }
  }

  const integration = await findIntegration(db, installationId)
  if (!integration) {
    return { status: 'ignored', reason: `no Realm integration for installation ${installationId}` }
  }
  const realmId = integration.realm_id

  try {
    switch (event) {
      case 'issues':
        return await handleIssues(db, realmId, payload as IssuesPayload)
      case 'issue_comment':
        return await handleIssueComment(db, realmId, payload as IssueCommentPayload)
      case 'pull_request':
        return await handlePullRequest(db, realmId, payload as PullRequestPayload)
      case 'push':
        return { status: 'ignored', reason: 'push events not mapped yet' }
      default:
        return { status: 'ignored', reason: `unhandled event: ${event}` }
    }
  } catch (error) {
    logger.error('event mapping failed', { event, realmId, error })
    return { status: 'error', reason: 'mapping failed' }
  }
}

function extractInstallationId(event: string, payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const installation = (payload as { installation?: GithubInstallation }).installation
  if (!installation || typeof installation.id !== 'number') return null
  return String(installation.id)
}

async function handleIssues(
  db: Db,
  realmId: string,
  payload: IssuesPayload,
): Promise<GithubWebhookResult> {
  const { action, issue, repository } = payload
  const existing = await findThreadByIssueId(db, realmId, issue.id)

  if (action === 'opened' || action === 'reopened') {
    if (existing) {
      await db
        .update(threads)
        .set({ status: 'open', title: issue.title, updated_at: new Date() })
        .where(eq(threads.id, existing.id))
      return { status: 'processed', reason: `thread ${existing.id} reopened` }
    }
    const project = await findDefaultProject(db, realmId)
    if (!project) {
      return { status: 'ignored', reason: 'realm has no project to bind thread' }
    }
    const [created] = await db
      .insert(threads)
      .values({
        realm_id: realmId,
        project_id: project.id,
        title: issue.title,
        status: 'open',
        code_anchor: githubIssueAnchor(issue, repository.full_name),
      })
      .returning({ id: threads.id })
    return { status: 'processed', reason: `thread ${created?.id} created from issue #${issue.number}` }
  }

  if (action === 'closed' && existing) {
    await db
      .update(threads)
      .set({ status: 'resolved', updated_at: new Date() })
      .where(eq(threads.id, existing.id))
    return { status: 'processed', reason: `thread ${existing.id} resolved` }
  }

  if (action === 'edited' && existing) {
    await db
      .update(threads)
      .set({ title: issue.title, updated_at: new Date() })
      .where(eq(threads.id, existing.id))
    return { status: 'processed', reason: `thread ${existing.id} title synced` }
  }

  return { status: 'ignored', reason: `issues.${action} not mapped` }
}

async function handleIssueComment(
  db: Db,
  realmId: string,
  payload: IssueCommentPayload,
): Promise<GithubWebhookResult> {
  if (payload.action !== 'created') {
    return { status: 'ignored', reason: `issue_comment.${payload.action} not mapped` }
  }
  const existing = await findThreadByIssueId(db, realmId, payload.issue.id)
  if (!existing) {
    return { status: 'ignored', reason: 'no thread bound to issue' }
  }

  let dialogueRef = existing.dialogue_ref
  if (!dialogueRef) {
    dialogueRef = crypto.randomUUID()
    await db
      .update(threads)
      .set({ dialogue_ref: dialogueRef, updated_at: new Date() })
      .where(eq(threads.id, existing.id))
  }

  await db.insert(dialogueMessages).values({
    realm_id: realmId,
    dialogue_id: dialogueRef,
    actor_type: 'human',
    actor_id: payload.comment.user?.login ?? 'github',
    role: 'user',
    content: payload.comment.body,
    metadata: {
      source: 'github',
      commentUrl: payload.comment.html_url,
      issueNumber: payload.issue.number,
    },
  })
  return { status: 'processed', reason: 'dialogue message appended' }
}

async function handlePullRequest(
  db: Db,
  realmId: string,
  payload: PullRequestPayload,
): Promise<GithubWebhookResult> {
  if (payload.action !== 'opened' && payload.action !== 'reopened') {
    return { status: 'ignored', reason: `pull_request.${payload.action} not mapped` }
  }
  const issueNumber = payload.pull_request.number
  const [linked] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.realm_id, realmId),
        isNull(threads.deleted_at),
        sql`${threads.code_anchor}->>'issueNumber' = ${String(issueNumber)}`,
      ),
    )
    .limit(1)

  if (!linked) {
    return { status: 'ignored', reason: 'no thread bound to PR issue number' }
  }
  await db
    .update(threads)
    .set({ manifestation_url: payload.pull_request.html_url, updated_at: new Date() })
    .where(eq(threads.id, linked.id))
  return { status: 'processed', reason: `manifestation url linked to thread ${linked.id}` }
}
