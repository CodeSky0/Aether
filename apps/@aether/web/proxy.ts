// @aether/web · Edge Proxy（Step 6：更快的登录检查；Next 16 proxy 约定）
// 职责：对用户个人路由（/dashboard、/settings）做会话 cookie 存在性检查，
// 无 cookie 即重定向 /login——在 Edge 完成，避免命中 Node runtime 的 RSC 渲染。
// 注意：这是存在性检查而非签名验证（Edge 无法访问 DB/secret）；
// 真正的鉴权仍在 Server Action / RSC 层（requireRealmRole / entitlement）。
// /realms 与 /realm 保持匿名可访问（无 auth 环境的预览行为不受影响）。

import { NextResponse, type NextRequest } from 'next/server'

/** Better-Auth 会话 cookie 名匹配片段：
 *  实际名称可能是 better-auth.session_token、better-auth.session_token.non_secure、
 *  或 HTTPS 环境自动加 __Secure- 前缀的变体。按子串匹配全部覆盖。 */
const SESSION_COOKIE_FRAGMENT = 'better-auth.session_token'

/** 需要会话 cookie 的路由前缀 */
const SESSION_REQUIRED_PREFIXES = ['/dashboard', '/settings']

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const requiresSession = SESSION_REQUIRED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  )
  if (!requiresSession) return NextResponse.next()

  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.includes(SESSION_COOKIE_FRAGMENT))

  if (!hasSessionCookie) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*'],
}
