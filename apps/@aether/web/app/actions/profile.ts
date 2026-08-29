// @aether/web · Profile Server Actions（Step 4：Better-Auth 集成）
// updateUser / changePassword 均走 auth.api 服务端接口，headers 携带会话 cookie。
// auth 未配置的环境返回明确错误（Profile 页据此展示引导文案）。
'use server'

import { headers } from 'next/headers'
import { z } from 'zod'

import { tryGetAuth } from '@/lib/auth'
import { runGuarded } from '@/lib/action-result'
import type { ActionResult } from '@/lib/action-result'

const updateProfileInputSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(100, '名称最长 100 字符'),
  email: z.string().trim().email('邮箱格式不正确'),
})

/**
 * 更新当前会话用户的名称与邮箱。
 * Better-Auth 契约：名称走 updateUser；邮箱变更走 changeEmail（触发验证邮件流程）。
 */
export async function updateProfile(
  input: z.infer<typeof updateProfileInputSchema>,
): Promise<ActionResult<{ name: string }>> {
  return runGuarded('updateProfile', async () => {
    const parsed = updateProfileInputSchema.parse(input)
    const auth = tryGetAuth()
    if (auth === null) {
      throw new Error('认证未配置：请在部署环境设置 BETTER_AUTH_URL 与 BETTER_AUTH_SECRET')
    }
    const requestHeaders = await headers()
    await auth.api.updateUser({
      headers: requestHeaders,
      body: {
        name: parsed.name,
      },
    })
    await auth.api.changeEmail({
      headers: requestHeaders,
      body: {
        newEmail: parsed.email,
      },
    })
    return { name: parsed.name }
  })
}

const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: z
    .string()
    .min(8, '新密码至少 8 位')
    .max(128, '新密码最长 128 位'),
})

/** 修改当前会话用户密码（Better-Auth changePassword；吊销其他会话）。 */
export async function changePassword(
  input: z.infer<typeof changePasswordInputSchema>,
): Promise<ActionResult<null>> {
  return runGuarded('changePassword', async () => {
    const parsed = changePasswordInputSchema.parse(input)
    const auth = tryGetAuth()
    if (auth === null) {
      throw new Error('认证未配置：请在部署环境设置 BETTER_AUTH_URL 与 BETTER_AUTH_SECRET')
    }
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: parsed.currentPassword,
        newPassword: parsed.newPassword,
        revokeOtherSessions: true,
      },
    })
    return null
  })
}

export interface ProfileSession {
  name: string
  email: string
  emailVerified: boolean
}

/** 读取当前会话用户（服务端聚合，Profile 页直出）；未登录返回 null。 */
export async function getProfileSession(): Promise<ProfileSession | null> {
  const auth = tryGetAuth()
  if (auth === null) return null
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })
    if (!session?.user) return null
    return {
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    }
  } catch {
    // 会话解析失败按未登录处理；Profile 页展示引导
    return null
  }
}
