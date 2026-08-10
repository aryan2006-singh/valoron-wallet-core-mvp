import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['./tests/unit/setup.ts'],
    env: {
      UPSTASH_REDIS_REST_URL: 'https://example-test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
