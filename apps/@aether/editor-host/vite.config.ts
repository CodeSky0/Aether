import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isApplicationBuild =
  process.env.VERCEL === '1' ||
  process.env.AETHER_EDITOR_HOST_APP_BUILD === 'true'

export default defineConfig({
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
