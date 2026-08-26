// @aether/converge-server · ESLint flat config
import base from '@aether/config/eslint/base'

export default [
  ...base,
  {
    ignores: ['dist/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // cf/ 目录使用 Cloudflare Workers 独立 tsconfig（不在 Node tsconfig 中）
    files: ['cf/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.cloudflare.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
