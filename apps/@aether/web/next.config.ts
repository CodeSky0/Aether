// @aether/web · Next.js 16 配置
// App Router / Server Actions / PPR / Edge。构建边界遵循 monorepo-structure.md：
// SSR/RSC 归 Next，高频模块与 UI 库归 Vite；本应用只承担服务端渲染与状态通道入口。
import type { NextConfig } from 'next'
const config: NextConfig = {
  reactStrictMode: true,
  // 让 Next.js 直接在仓库根目录生成产物，匹配 Vercel 的 Root Directory 配置。
  // 这样 HTML、RSC、serverless functions 与 /_next/static 使用同一份构建。
  distDir: '../../.next',
  // 允许在线预览域名访问 dev server（Next 16 使用 allowedDevOrigins 替代旧 experimental.allowedHosts）
  allowedDevOrigins: ['.monkeycode-ai.online'],
  transpilePackages: [
    '@aether/current-sync',
    '@aether/db',
    '@aether/state',
    '@aether/types',
    '@aether/ui',
  ],
}
export default config
