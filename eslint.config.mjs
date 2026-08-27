import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    settings: {
      next: {
        rootDir: 'apps/web'
      }
    }
  },
  {
    files: ['**/*.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/*.tsbuildinfo',
    '.turbo/**',
    'coverage/**',
    'apps/web/next-env.d.ts'
  ])
])
