// @aether/web · 团队加入码 + 加入申请审批流 Server Actions
// UI 文案称"团队"，数据层复用 Realm。单码 + 审批流：
// 凭 join code 提交 → pending join_request → owner/admin approve → members(active) + organization.addMember。
'use server'

import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { members, realmJoinCodes, realmJoinRequests, realms } from '@aether/db'
import {
  isPlaceholderOrganization,
  provisionOrganizationMember,
  user,
} from '@aether/auth'
import { resolveCurrentActor } from '@/lib/auth-guard'
import { tryGetAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { requireRealmRole } from '@/lib/membership-guard'
import { runGuarded, realmIdField } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

// ---- join code 生成 ----
// 去歧义字母表：去掉 I/L/O/0/1，用户手输不易错。30 字符，% 30 偏置可忽略。
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const JOIN_CODE_LENGTH = 8

function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET.charAt(
      bytes[i]! % JOIN_CODE_ALPHABET.length,
    )
  }
  return code
}

async function generateUniqueJoinCode(): Promise<string> {
  const db = getDb()
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateJoinCode()
    const existing = await db
      .select({ code: realmJoinCodes.code })
      .from(realmJoinCodes)
      .where(eq(realmJoinCodes.code, code))
      .limit(1)
    if (existing.length === 0) return code
  }
  throw new Error('生成加入码失败：多次碰撞，请重试')
}

const realmIdSchema = z.object({ realmId: realmIdField })

// ---- join code: 读取/确保/轮换 ----

/** 取 Realm 当前活跃加入码（明文，仅 owner/admin）。无码返回 null。 */
export async function getActiveJoinCode(
  input: z.infer<typeof realmIdSchema>,
): Promise<ActionResult<{ code: string } | null>> {
  return runGuarded('getActiveJoinCode', async () => {
    const parsed = realmIdSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const [row] = await db
      .select({ code: realmJoinCodes.code })
      .from(realmJoinCodes)
      .where(
        and(
          eq(realmJoinCodes.realm_id, parsed.realmId),
          isNull(realmJoinCodes.revoked_at),
        ),
      )
      .limit(1)
    return row ? { code: row.code } : null
  })
}

/** 为 Realm 生成加入码（若已有活跃码则返回现有）。owner/admin 可调。 */
export async function ensureJoinCode(
  input: z.infer<typeof realmIdSchema>,
): Promise<ActionResult<{ code: string }>> {
  return runGuarded('ensureJoinCode', async () => {
    const parsed = realmIdSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const [existing] = await db
      .select({ code: realmJoinCodes.code })
      .from(realmJoinCodes)
      .where(
        and(
          eq(realmJoinCodes.realm_id, parsed.realmId),
          isNull(realmJoinCodes.revoked_at),
        ),
      )
      .limit(1)
    if (existing) return { code: existing.code }
    const code = await generateUniqueJoinCode()
    await db.insert(realmJoinCodes).values({
      realm_id: parsed.realmId,
      code,
      created_by: actor.actorId,
    })
    return { code }
  })
}

/** 轮换加入码（吊销旧码 + 生成新码）。owner/admin 可调。 */
export async function rotateJoinCode(
  input: z.infer<typeof realmIdSchema>,
): Promise<ActionResult<{ code: string }>> {
  return runGuarded('rotateJoinCode', async () => {
    const parsed = realmIdSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const code = await generateUniqueJoinCode()
    return db.transaction(async (tx) => {
      await tx
        .update(realmJoinCodes)
        .set({ revoked_at: new Date() })
        .where(
          and(
            eq(realmJoinCodes.realm_id, parsed.realmId),
            isNull(realmJoinCodes.revoked_at),
          ),
        )
      await tx.insert(realmJoinCodes).values({
        realm_id: parsed.realmId,
        code,
        created_by: actor.actorId,
      })
      return { code }
    })
  })
}

// ---- 加入申请：提交/列表/审批 ----

const submitJoinRequestSchema = z.object({
  code: z.string().trim().min(1, '加入码不能为空').max(20, '加入码格式非法'),
  message: z.string().trim().max(500, '申请留言最长 500 字符').optional(),
})

/** 凭加入码提交加入申请。已登录用户调用；重复 pending 由 partial unique 约束兜底。 */
export async function submitJoinRequest(
  input: z.infer<typeof submitJoinRequestSchema>,
): Promise<ActionResult<{ id: string; realmName: string }>> {
  return runGuarded('submitJoinRequest', async () => {
    const parsed = submitJoinRequestSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    const db = getDb()
    const normalizedCode = parsed.code.toUpperCase()
    const [codeRow] = await db
      .select({ realmId: realmJoinCodes.realm_id, code: realmJoinCodes.code })
      .from(realmJoinCodes)
      .where(
        and(
          eq(realmJoinCodes.code, normalizedCode),
          isNull(realmJoinCodes.revoked_at),
        ),
      )
      .limit(1)
    if (!codeRow) throw new Error('加入码无效或已失效')
    const [realm] = await db
      .select({ id: realms.id, name: realms.name })
      .from(realms)
      .where(and(eq(realms.id, codeRow.realmId), isNull(realms.deleted_at)))
      .limit(1)
    if (!realm) throw new Error('团队不存在或已被删除')
    const [existingMember] = await db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.realm_id, realm.id),
          eq(members.actor_type, 'human'),
          eq(members.actor_id, actor.actorId),
          eq(members.status, 'active'),
        ),
      )
      .limit(1)
    if (existingMember) throw new Error('你已是该团队成员')
    const [request] = await db
      .insert(realmJoinRequests)
      .values({
        realm_id: realm.id,
        user_id: actor.actorId,
        join_code: codeRow.code,
        requested_role: 'member',
        status: 'pending',
        message: parsed.message ?? null,
      })
      .returning({ id: realmJoinRequests.id })
    if (!request) throw new Error('创建加入申请失败')
    return { id: request.id, realmName: realm.name }
  })
}

export interface PendingJoinRequestRow {
  id: string
  userId: string
  userName: string
  userEmail: string
  requestedRole: string
  message: string | null
  createdAt: Date
}

/** 列出 Realm 的 pending 加入申请（联 user 表取申请人名称）。owner/admin 可调。 */
export async function listPendingJoinRequests(
  input: z.infer<typeof realmIdSchema>,
): Promise<ActionResult<PendingJoinRequestRow[]>> {
  return runGuarded('listPendingJoinRequests', async () => {
    const parsed = realmIdSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    return db
      .select({
        id: realmJoinRequests.id,
        userId: realmJoinRequests.user_id,
        userName: user.name,
        userEmail: user.email,
        requestedRole: realmJoinRequests.requested_role,
        message: realmJoinRequests.message,
        createdAt: realmJoinRequests.created_at,
      })
      .from(realmJoinRequests)
      .innerJoin(user, eq(realmJoinRequests.user_id, user.id))
      .where(
        and(
          eq(realmJoinRequests.realm_id, parsed.realmId),
          eq(realmJoinRequests.status, 'pending'),
        ),
      )
      .orderBy(desc(realmJoinRequests.created_at))
  })
}

export interface MyJoinRequestRow {
  id: string
  realmId: string
  realmName: string
  status: 'pending' | 'approved' | 'rejected'
  requestedRole: string
  createdAt: Date
  reviewedAt: Date | null
}

/** 当前用户查自己的加入申请（含所有状态），用于 onboarding/dashboard 展示等待审批态。 */
export async function listMyJoinRequests(): Promise<
  ActionResult<MyJoinRequestRow[]>
> {
  return runGuarded('listMyJoinRequests', async () => {
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    const db = getDb()
    return db
      .select({
        id: realmJoinRequests.id,
        realmId: realmJoinRequests.realm_id,
        realmName: realms.name,
        status: realmJoinRequests.status,
        requestedRole: realmJoinRequests.requested_role,
        createdAt: realmJoinRequests.created_at,
        reviewedAt: realmJoinRequests.reviewed_at,
      })
      .from(realmJoinRequests)
      .innerJoin(realms, eq(realmJoinRequests.realm_id, realms.id))
      .where(eq(realmJoinRequests.user_id, actor.actorId))
      .orderBy(desc(realmJoinRequests.created_at))
  })
}

const reviewSchema = z.object({
  realmId: realmIdField,
  requestId: z.string().uuid('requestId 必须是 UUID'),
  /** 审批时可调整角色，但不能授予 owner */
  role: z.enum(['member', 'viewer', 'admin']).optional(),
})

/** 批准加入申请：更新申请状态 + 插/更新领域 members + 同步 Better-Auth org member。 */
export async function approveJoinRequest(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('approveJoinRequest', async () => {
    const parsed = reviewSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const auth = tryGetAuth()

    const [row] = await db
      .select({
        request: realmJoinRequests,
        authOrgId: realms.auth_org_id,
      })
      .from(realmJoinRequests)
      .innerJoin(realms, eq(realmJoinRequests.realm_id, realms.id))
      .where(
        and(
          eq(realmJoinRequests.id, parsed.requestId),
          eq(realmJoinRequests.realm_id, parsed.realmId),
          eq(realmJoinRequests.status, 'pending'),
        ),
      )
      .limit(1)
    if (!row) throw new Error('加入申请不存在或已处理')

    const role = parsed.role ?? row.request.requested_role
    const targetUserId = row.request.user_id

    await db.transaction(async (tx) => {
      await tx
        .update(realmJoinRequests)
        .set({
          status: 'approved',
          reviewed_by: actor.actorId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(realmJoinRequests.id, parsed.requestId))

      const [existingMember] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.realm_id, parsed.realmId),
            eq(members.actor_type, 'human'),
            eq(members.actor_id, targetUserId),
            isNull(members.project_id),
          ),
        )
        .limit(1)
      if (existingMember) {
        await tx
          .update(members)
          .set({ role, status: 'active', updated_at: new Date() })
          .where(eq(members.id, existingMember.id))
      } else {
        await tx.insert(members).values({
          realm_id: parsed.realmId,
          project_id: null,
          actor_type: 'human',
          actor_id: targetUserId,
          role,
          entitlements: {},
          status: 'active',
        })
      }
    })

    if (auth && !isPlaceholderOrganization(row.authOrgId)) {
      try {
        await provisionOrganizationMember(auth, {
          organizationId: row.authOrgId,
          userId: targetUserId,
          role: role as 'owner' | 'admin' | 'member' | 'viewer',
        })
      } catch {
        // 已是 org member 时 addMember 抛错；领域 members 已写，忽略 auth 侧重复
      }
    }
    return { id: parsed.requestId }
  })
}

/** 拒绝加入申请：仅更新状态，不写 members。 */
export async function rejectJoinRequest(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runGuarded('rejectJoinRequest', async () => {
    const parsed = reviewSchema.parse(input)
    const actor = await resolveCurrentActor()
    if (actor === null) throw new Error('需要登录会话')
    await requireRealmRole(parsed.realmId, actor, ['owner', 'admin'])
    const db = getDb()
    const [updated] = await db
      .update(realmJoinRequests)
      .set({
        status: 'rejected',
        reviewed_by: actor.actorId,
        reviewed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(realmJoinRequests.id, parsed.requestId),
          eq(realmJoinRequests.realm_id, parsed.realmId),
          eq(realmJoinRequests.status, 'pending'),
        ),
      )
      .returning({ id: realmJoinRequests.id })
    if (!updated) throw new Error('加入申请不存在或已处理')
    return updated
  })
}

// ---- onboarding 守卫辅助 ----

/**
 * 用户是否已完成 onboarding：存在任意 membership 或非 rejected 的 join_request。
 * pending 申请视为已 onboarding（避免用户卡死）；rejected 后可重新申请。
 */
export async function hasUserOnboarded(): Promise<boolean> {
  const actor = await resolveCurrentActor()
  if (actor === null) return false
  const db = getDb()
  const [memberRow] = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(eq(members.actor_type, 'human'), eq(members.actor_id, actor.actorId)),
    )
    .limit(1)
  if (memberRow) return true
  const [requestRow] = await db
    .select({ id: realmJoinRequests.id })
    .from(realmJoinRequests)
    .where(
      and(
        eq(realmJoinRequests.user_id, actor.actorId),
        sql`${realmJoinRequests.status} <> 'rejected'`,
      ),
    )
    .limit(1)
  return !!requestRow
}
