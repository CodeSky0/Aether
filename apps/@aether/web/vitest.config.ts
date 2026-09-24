// @aether/web · Vitest 配置
// 与 Next.js 共享 tsconfig 路径别名；默认 node 环境（Server Actions 逻辑在服务端）。
// React 组件测试用 `// @vitest-environment jsdom` 注释切换到 jsdom 环境。
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
})
