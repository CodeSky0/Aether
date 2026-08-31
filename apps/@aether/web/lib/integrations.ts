// @aether/web · Realm 集成（Resonance）DB 操作
// upsert GitHub installation：活跃记录存在则更新，否则插入。
// 处理 partial unique index (realm_id, provider) WHERE deleted_at IS NULL：
//   先查活跃记录，有则 update，无则 insert——避免 partial index ON CONFLICT 的方言复杂度。
import { realmIntegrations } from '@aether/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'

export interface UpsertGithubIntegrationInput {
  realmId: string
  installationId: string
  createdBy: string
  /** 可选绑定单个 repo（owner/name）；空表示 installation 下全部 repo 共振 */
  repoFullName?: string
}

export interface UpsertResult {
  id: string
  created: boolean
}

/**
 * 写入或刷新 Realm 的 GitHub App installation 连接。
 * 同一 Realm 的活跃 GitHub 集成至多一条；重复安装视为刷新 installation_id。
 */
export async function upsertGithubIntegration(
  input: UpsertGithubIntegrationInput,
): Promise<UpsertResult> {
  const db = getDb()
  const [existing] = await db
    .select({ id: realmIntegrations.id })
    .from(realmIntegrations)
    .where(
      and(
        eq(realmIntegrations.realm_id, input.realmId),
        eq(realmIntegrations.provider, 'github'),
        isNull(realmIntegrations.deleted_at),
      ),
    )
    .limit(1)

  if (existing) {
    await db
      .update(realmIntegrations)
      .set({
        installation_id: input.installationId,
        status: 'active',
        updated_at: new Date(),
        ...(input.repoFullName !== undefined
          ? { repo_full_name: input.repoFullName }
          : {}),
      })
      .where(eq(realmIntegrations.id, existing.id))
    return { id: existing.id, created: false }
  }

  const rows = await db
    .insert(realmIntegrations)
    .values({
      realm_id: input.realmId,
      provider: 'github',
      installation_id: input.installationId,
      created_by: input.createdBy,
      status: 'active',
      ...(input.repoFullName !== undefined
        ? { repo_full_name: input.repoFullName }
        : {}),
    })
    .returning({ id: realmIntegrations.id })
  const inserted = rows[0]
  if (!inserted) {
    throw new Error('Failed to insert Realm GitHub integration')
  }
  return { id: inserted.id, created: true }
}
