// @aether/web · Realm 集成（Resonance）DB 操作
// upsert GitHub installation：活跃记录存在则更新，否则插入。
// 处理 partial unique index (realm_id, provider) WHERE deleted_at IS NULL：
//   先查活跃记录，有则 update，无则 insert——避免 partial index ON CONFLICT 的方言复杂度。
import { realmIntegrations } from '@aether/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  fetchInstallationAccessToken,
  encryptSecret,
  decryptSecret,
  importAesKey,
} from '@aether/resonance'
import {
  requireGithubAppConfig,
  requireIntegrationEncryptionKey,
} from '@/lib/github'

export interface RealmIntegrationRow {
  id: string
  provider: 'github' | 'gitlab' | 'linear'
  installation_id: string
  repo_full_name: string | null
  status: 'active' | 'disconnected' | 'error'
  created_at: Date
  updated_at: Date
}

/** 列出 Realm 的活跃集成（deleted_at IS NULL），按创建时间降序。 */
export async function listRealmIntegrations(
  realmId: string,
): Promise<RealmIntegrationRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: realmIntegrations.id,
      provider: realmIntegrations.provider,
      installation_id: realmIntegrations.installation_id,
      repo_full_name: realmIntegrations.repo_full_name,
      status: realmIntegrations.status,
      created_at: realmIntegrations.created_at,
      updated_at: realmIntegrations.updated_at,
    })
    .from(realmIntegrations)
    .where(
      and(
        eq(realmIntegrations.realm_id, realmId),
        isNull(realmIntegrations.deleted_at),
      ),
    )
    .orderBy(realmIntegrations.created_at)
  return rows
}

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

/** token 过期缓冲：提前 5 分钟视为过期，避免请求时刚好过期 */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000

/**
 * 获取 Realm 的有效 GitHub installation access token（明文）。
 * 闭环：读 encrypted_token 缓存 → 未过期则解密返回 → 过期/无缓存则换发 → 加密写回 → 返回明文。
 * 无 GitHub 集成或集成非活跃时返回 null（fail-closed，调用方据此拒绝 GitHub API 调用）。
 */
export async function getValidInstallationToken(
  realmId: string,
): Promise<string | null> {
  const db = getDb()
  const [integration] = await db
    .select({
      id: realmIntegrations.id,
      installation_id: realmIntegrations.installation_id,
      encrypted_token: realmIntegrations.encrypted_token,
      token_expires_at: realmIntegrations.token_expires_at,
      status: realmIntegrations.status,
    })
    .from(realmIntegrations)
    .where(
      and(
        eq(realmIntegrations.realm_id, realmId),
        eq(realmIntegrations.provider, 'github'),
        eq(realmIntegrations.status, 'active'),
        isNull(realmIntegrations.deleted_at),
      ),
    )
    .limit(1)

  if (!integration) return null

  // 缓存命中且未过期（留 5 分钟缓冲）
  if (integration.encrypted_token && integration.token_expires_at) {
    const expiresAt = integration.token_expires_at.getTime()
    if (Date.now() + TOKEN_EXPIRY_BUFFER_MS < expiresAt) {
      const aesKey = await importAesKey(requireIntegrationEncryptionKey())
      return decryptSecret(integration.encrypted_token, aesKey)
    }
  }

  // 换发：App JWT → installation access token
  const config = requireGithubAppConfig()
  const { token, expiresAt } = await fetchInstallationAccessToken(
    integration.installation_id,
    { appId: config.appId, privateKeyPem: config.privateKeyPem },
  )

  // 加密写回缓存
  const aesKey = await importAesKey(requireIntegrationEncryptionKey())
  const encryptedToken = await encryptSecret(token, aesKey)
  await db
    .update(realmIntegrations)
    .set({
      encrypted_token: encryptedToken,
      token_expires_at: expiresAt,
      updated_at: new Date(),
    })
    .where(eq(realmIntegrations.id, integration.id))

  return token
}
