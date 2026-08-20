import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isApplicationBuild =
  process.env.VERCEL === '1' ||
  process.env.AETHER_EDITOR_HOST_APP_BUILD === 'true'

// 嵌入 Web 子路径（/editor/）为默认；独立站点部署（editor.aether.cosky.top）
// 在 Vercel buildCommand 中显式设置 AETHER_EDITOR_HOST_BASE=/
const base = process.env.AETHER_EDITOR_HOST_BASE ?? '/editor/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  ...(isApplicationBuild
    ? {}
    : {
        build: {
          lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: 'index',
          },
          rollupOptions: {
            external: ['@aether/current-sync'],
          },
        },
      }),
})
