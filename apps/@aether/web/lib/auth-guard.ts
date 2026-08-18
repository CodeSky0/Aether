// @aether/web · 轻量鉴权守卫（M1 占位层）
// P2-18 修复：M1 阶段无完整 auth 体系，提供可关闭的基础守卫：
//   1. 校验 realmId 为合法 UUID（防止注入/越权遍历）
//   2. 校验 Realm 存在（防止操作不存在的租户）
// M3.8 起本文件同时承载 Entitlement Engine 三级判定入口 requireEntitlement。
//
// 环境变量 AETHER_AUTH_GUARD_ENABLED 控制是否启用（默认 true）。
// 开发调试时可设为 false 关闭守卫。
'use server'
import { headers } from 'next/headers'
import { resolveSessionActor } from '@aether/auth'
import { getDb } from '@/lib/db'
import { tryGetAuth } from '@/lib/auth'
import { realms } from '@aether/db'
import { eq } from 'drizzle-orm'
import {
  assertEntitlement,
  loadEntitlementSubject,
  type EntitlementRequest,
} from '@aether/entitlement'
import type { ActorType } from '@aether/types'
import { ensureRealmMembership } from '@/lib/membership-provisioning'
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isGuardEnabled(): boolean {
  return process.env.AETHER_AUTH_GUARD_ENABLED !== 'false'
}
function isEntitlementEnabled(): boolean {
  return process.env.AETHER_ENTITLEMENT_ENABLED === 'true'
}
let entitlementDisabledNoticeLogged = false
let authNotConfiguredWarningLogged = false
let authResolutionFailureWarningLogged = false
export interface CurrentActor {
  actorType: ActorType
  actorId: string
}
/**
 * 解析当前请求主体。浏览器会话只解析 human actor。
 */
export async function resolveCurrentActor(): Promise<CurrentActor | null> {
  const auth = tryGetAuth()
  if (auth === null) {
    if (!authNotConfiguredWarningLogged) {
      authNotConfiguredWarningLogged = true
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-guard] Better-Auth is not configured; session actor resolution is unavailable',
      )
    }
    return null
  }
  try {
    const sessionActor = await resolveSessionActor(auth, await headers())
    if (sessionActor === null) return null
    return {
      actorType: sessionActor.actorType,
      actorId: sessionActor.actorId,
    }
  } catch {
    if (!authResolutionFailureWarningLogged) {
      authResolutionFailureWarningLogged = true
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-guard] Better-Auth session resolution failed; returning null for fail-closed enforcement',
      )
    }
    return null
  }
}
/**
 * 校验 realmId 格式并确认 Realm 存在。
 * @throws Error 当 realmId 格式非法或 Realm 不存在时
 */
export async function requireRealmAccess(realmId: string): Promise<void> {
  if (!isGuardEnabled()) return
  if (!UUID_REGEX.test(realmId)) {
    throw new Error('Invalid realmId: must be a valid UUID')
  }
  const db = getDb()
  const existing = await db
    .select({ id: realms.id })
    .from(realms)
    .where(eq(realms.id, realmId))
    .limit(1)
  if (existing.length === 0) {
    throw new Error(`Realm not found: ${realmId}`)
  }
}

/**
 * 在 Realm 存在性校验后执行 Entitlement Engine 判定。
 * 开关关闭时保持现有 M1/M3.5 行为，仅记录 debug 日志并放行。
 */
export async function requireEntitlement(
  realmId: string,
  request: EntitlementRequest,
): Promise<void> {
  await requireRealmAccess(realmId)
  if (!isEntitlementEnabled()) {
    if (!entitlementDisabledNoticeLogged) {
      entitlementDisabledNoticeLogged = true
      // eslint-disable-next-line no-console
      console.debug('[auth-guard] Entitlement Engine disabled; allowing request')
    }
    return
  }

  const actor = await resolveCurrentActor()
  if (actor === null) {
    throw new Error(
      'Entitlement denied fail-closed: no authenticated actor could be resolved',
    )
  }
  await ensureRealmMembership({
    realmId,
    actorType: actor.actorType,
    actorId: actor.actorId,
  })
  const subject = await loadEntitlementSubject(getDb(), {
    realmId,
    actorType: actor.actorType,
    actorId: actor.actorId,
  })
  assertEntitlement(subject, request)
}
