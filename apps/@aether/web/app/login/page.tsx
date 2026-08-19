// @aether/web · 登录页
// auth 未配置时给出可读提示，不渲染表单。
import Link from 'next/link'

import AuthForms from '@/components/auth-forms'
import { getWebOidcProvider, tryGetAuth } from '@/lib/auth'

export default function LoginPage() {
  const authConfigured = tryGetAuth() !== null
  const oidcProvider = authConfigured ? getWebOidcProvider() : null

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="text-caption-10 uppercase tracking-[1.5px] text-neutral-6">
        Sign in to Aether
      </p>
      <h1 className="mt-2 font-serif text-title-28 font-medium text-neutral-10">
        登录
      </h1>
      <p className="mt-3 text-copy-14 text-neutral-7">
        登录后可访问你有成员资格的 Realm；通过 SSO 登录的成员会自动获得访问权。
      </p>

      <div className="mt-8">
        {authConfigured ? (
          <AuthForms oidcProvider={oidcProvider} />
        ) : (
          <div className="rounded-md bg-error/10 p-4 text-label-12 text-error">
            <p>认证未配置：请设置 BETTER_AUTH_URL 与 BETTER_AUTH_SECRET 后重启。</p>
            <Link href="/" className="mt-2 inline-block underline">
              返回首页
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
