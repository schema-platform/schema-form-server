import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    fileParallelism: false,
    env: {
      SKIP_PERMISSION_CHECK: 'true',
    },
  },
})
