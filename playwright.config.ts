import { defineConfig } from '@playwright/test'
import { config } from 'dotenv'
import path from 'path'

// Task 16's critical-path.spec.ts creates its own Supabase admin client
// directly in the test file (Node/Playwright-runner process), unlike
// Tasks 8/9's e2e tests which only ever talk to the already-running Next
// dev server via page.goto(...). The webServer subprocess below loads
// .env.local automatically (Next.js's built-in dotenv support), but the
// Playwright test-runner process does not — without this, any e2e test
// file that reads process.env.NEXT_PUBLIC_SUPABASE_URL/etc directly fails
// with "supabaseUrl is required" before a single test runs. Same loading
// pattern as tests/integration/setup.ts.
config({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:3000' },
})
