// @aether/web · 登录页（Yohaku V0.1）
// 结构：品牌头（serif + 梅红点）→ mono 副题 → ring 卡片表单 → 版本脚注。
// 深度只用 ring（戒律 07）；卡片与页面同为 n-1，以描边分隔；暗色随系统自动反转。
import Link from 'next/link'

import AuthForms from '@/components/auth-forms'
import { getWebOidcProvider, tryGetAuth } from '@/lib/auth'

export default function LoginPage() {
  const authConfigured = tryGetAuth() !== null
  const oidcProvider = authConfigured ? getWebOidcProvider() : null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-1 px-6 py-16">
      <header className="enter text-center">
        <h1 className="font-serif text-display-36 font-medium tracking-tight text-neutral-10">
          Aether<span className="text-accent">.</span>
        </h1>
        <p className="mt-2 font-mono text-label-12 uppercase tracking-widest text-neutral-6">
          collaborative intelligence
        </p>
      </header>

      <main
        className="enter mt-10 w-full max-w-sm"
        style={{ animationDelay: '80ms' }}
      >
        <div className="rounded-xl bg-neutral-1 p-8 ring-1 ring-border">
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
      </main>

      <footer
        className="enter mt-10 font-mono text-caption-10 text-neutral-6"
        style={{ animationDelay: '160ms' }}
      >
        Yohaku V0.1 · Aether
      </footer>
    </div>
  )
}
