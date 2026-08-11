import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
