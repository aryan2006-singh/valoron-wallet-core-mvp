# Monorepo Restructure (apps/web + apps/api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the repo into `apps/web` (the entire Next.js app) and `apps/api` (the Supabase backend: migrations, RLS, RPCs, config) under npm workspaces, with zero behavior change and no changes required to `render.yaml`.

**Architecture:** npm workspaces (`"workspaces": ["apps/*"]`) with a thin root `package.json` whose scripts dispatch to `apps/web` (`npm run <script> -w apps/web`). `apps/api` holds only `supabase/` (SQL + config) since it has no JS/TS of its own — the Supabase CLI just needs a directory literally named `supabase/` at its working directory.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Supabase CLI, npm workspaces, Vitest, Playwright, GitHub Actions, Docker (for local Supabase).

## Global Constraints

- Pure structural move — no dependency upgrades, no logic changes, no renamed exports, no file splitting beyond what's specified below.
- Every file move uses `git mv` (history/blame preservation), never delete+recreate.
- `render.yaml` must end this plan byte-for-byte unchanged (verified by `git diff` showing no changes to it).
- Full verification (lint, typecheck, build, unit, integration via local Supabase/Docker, e2e via Playwright) must pass before this is considered done — per the approved design spec at [docs/superpowers/specs/2026-08-12-monorepo-web-api-restructure-design.md](../specs/2026-08-12-monorepo-web-api-restructure-design.md).

---

### Task 1: Move Supabase backend into `apps/api`

**Files:**
- Move: `supabase/` (all contents: `migrations/*.sql`, `config.toml`, `.gitignore`) → `apps/api/supabase/`

**Interfaces:**
- Produces: a Supabase CLI project rooted at `apps/api/` — later tasks (CI, verification) invoke `supabase` commands with `apps/api` as the working directory.

- [ ] **Step 1: Move the directory**

```bash
mkdir -p apps/api
git mv supabase apps/api/supabase
```

- [ ] **Step 2: Verify the move preserved history**

```bash
git status
git log --follow --oneline apps/api/supabase/config.toml | head -5
```
Expected: `git status` shows all files under `apps/api/supabase/` as renames (`renamed:`, not `new file:` + `deleted:`); `git log --follow` shows the original commits that touched `config.toml` before the move.

- [ ] **Step 3: Verify the CLI resolves config from the new location**

```bash
cd apps/api && supabase start
```
Expected: Supabase CLI finds `config.toml` and applies all 10 migrations in `supabase/migrations/` without error (proves the move didn't break relative paths inside the Supabase project). This starts Docker containers.

- [ ] **Step 4: Stop the stack** (frees Docker/ports; Task 4 restarts it for integration/e2e tests)

```bash
supabase stop
cd ../..
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Move Supabase backend into apps/api"
```

---

### Task 2: Move the Next.js app into `apps/web` and wire up npm workspaces

**Files:**
- Move: `app/`, `components/`, `lib/`, `types/`, `public/`, `tests/`, `middleware.ts`, `next.config.ts`, `instrumentation.ts`, `instrumentation-client.ts`, `sentry.edge.config.ts`, `sentry.server.config.ts`, `components.json`, `eslint.config.mjs`, `postcss.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `.env.example`, `package.json` → same names under `apps/web/`
- Create: `package.json` (new root workspace manifest)
- Modify: `.gitignore`, `apps/web/eslint.config.mjs`, `apps/web/package.json` (name field only)

**Interfaces:**
- Consumes: nothing from Task 1 (independent subtree)
- Produces: root `package.json` with `"workspaces": ["apps/*"]` and dispatcher scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`) — Task 3 (CI) and Task 4 (verification) invoke these exact script names from the repo root.

- [ ] **Step 1: Move every Next.js app file/directory**

```bash
mkdir -p apps/web
git mv app apps/web/app
git mv components apps/web/components
git mv lib apps/web/lib
git mv types apps/web/types
git mv public apps/web/public
git mv tests apps/web/tests
git mv middleware.ts apps/web/middleware.ts
git mv next.config.ts apps/web/next.config.ts
git mv instrumentation.ts apps/web/instrumentation.ts
git mv instrumentation-client.ts apps/web/instrumentation-client.ts
git mv sentry.edge.config.ts apps/web/sentry.edge.config.ts
git mv sentry.server.config.ts apps/web/sentry.server.config.ts
git mv components.json apps/web/components.json
git mv eslint.config.mjs apps/web/eslint.config.mjs
git mv postcss.config.mjs apps/web/postcss.config.mjs
git mv tsconfig.json apps/web/tsconfig.json
git mv vitest.config.ts apps/web/vitest.config.ts
git mv vitest.integration.config.ts apps/web/vitest.integration.config.ts
git mv playwright.config.ts apps/web/playwright.config.ts
git mv .env.example apps/web/.env.example
git mv package.json apps/web/package.json
```
`package-lock.json` and `.gitignore` stay at the repo root — do not move them.

- [ ] **Step 2: Rename the moved package's `name` field**

Edit `apps/web/package.json` line 2 from `"name": "valoron-wallet-core-mvp",` to `"name": "web",`. Leave every other field (scripts, dependencies, devDependencies) untouched.

- [ ] **Step 3: Remove the now-nonexistent `supabase/.temp/**` ignore from the moved eslint config**

Edit `apps/web/eslint.config.mjs` to:

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

- [ ] **Step 4: Create the root workspace `package.json`**

Create `package.json` at the repo root:

```json
{
  "name": "valoron-wallet-core-mvp",
  "private": true,
  "workspaces": [
    "apps/*"
  ],
  "scripts": {
    "dev": "npm run dev -w apps/web",
    "build": "npm run build -w apps/web",
    "start": "npm run start -w apps/web",
    "lint": "npm run lint -w apps/web",
    "typecheck": "npm run typecheck -w apps/web",
    "test:unit": "npm run test:unit -w apps/web",
    "test:integration": "npm run test:integration -w apps/web",
    "test:e2e": "npm run test:e2e -w apps/web"
  }
}
```

- [ ] **Step 5: Unanchor root-relative `.gitignore` patterns so they match inside `apps/web/`**

Edit `.gitignore` to:

```
# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies
node_modules
.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
coverage
test-results/
playwright-report/

# next.js
.next/
out/

# production
build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files (can opt-in for committing if needed)
.env*
!.env.example

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 6: Install dependencies and verify the workspace resolves**

```bash
npm install
```
Expected: npm installs into a single root `node_modules/` (hoisted), recognizes `apps/web` as a workspace, and updates `package-lock.json` in place (still at repo root) to reflect the workspace topology. No errors.

- [ ] **Step 7: Verify lint, typecheck, and build all pass from the new structure**

```bash
npm run lint
npm run typecheck
npm run build
```
Expected: all three succeed with no errors, dispatched through to `apps/web` (build output lands in `apps/web/.next/`, correctly ignored per Step 5).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Move Next.js app into apps/web; add npm workspaces root package.json"
```

---

### Task 3: Update CI for the new working directories

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1's `apps/api/supabase/` location, Task 2's root dispatcher scripts and `apps/web/.env.local` target path.

- [ ] **Step 1: Point the Supabase start step at `apps/api` and the env-file write at `apps/web`**

Edit `.github/workflows/ci.yml` so the two affected steps read:

```yaml
      - name: Start local Supabase stack (applies all migrations)
        working-directory: apps/api
        run: supabase start

      - name: Write .env.local for the Next.js app and Playwright's dev server
        run: |
          {
            echo "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL"
            echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY"
            echo "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"
            echo "STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY"
            echo "STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET"
            echo "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
            echo "UPSTASH_REDIS_REST_URL=$UPSTASH_REDIS_REST_URL"
            echo "UPSTASH_REDIS_REST_TOKEN=$UPSTASH_REDIS_REST_TOKEN"
            echo "NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL"
            echo "NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN"
          } >> apps/web/.env.local
```

All other steps (`checkout`, `setup-node`, `npm ci`, `supabase/setup-cli`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, Playwright install, `npm run test:e2e`, `npm run build`) are unchanged — they still work because Task 2's root `package.json` dispatches them to `apps/web`.

- [ ] **Step 2: Validate the YAML is well-formed**

```bash
node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" 
```
Expected: no parse error. (If neither `yaml` npm package nor Python's `yaml` module is available, visually diff the two edited steps against the block above instead — the edit is a 2-line `working-directory` insert and a 1-line path change, low risk of a YAML syntax error.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Update CI working directories for apps/web + apps/api layout"
```

---

### Task 4: Full local verification and final sanity check

**Files:**
- Modify: none expected (this task runs tests; if a test failure reveals a missed path/config from Tasks 1-3, fix the specific file identified by the failure and note it in the commit message)

**Interfaces:**
- Consumes: Task 1's `apps/api/supabase/`, Task 2's root dispatcher scripts and `apps/web/` app, Task 3's CI config (not executed here, but its assumptions are validated indirectly by running the same commands locally).

- [ ] **Step 1: Create a local `.env.local` for `apps/web`** (mirrors what CI writes, using the same publicly-documented local Supabase demo keys and test/placeholder values CI uses — see `.github/workflows/ci.yml`)

```bash
cat > apps/web/.env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
STRIPE_SECRET_KEY=sk_test_ci_placeholder
STRIPE_WEBHOOK_SECRET=whsec_ci_placeholder
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_ci_placeholder
UPSTASH_REDIS_REST_URL=https://example-ci.upstash.io
UPSTASH_REDIS_REST_TOKEN=ci-placeholder-token
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SENTRY_DSN=
EOF
```
This file is gitignored (`.env*` pattern from Task 2 Step 5) — it will not be committed.

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```
Expected: all unit tests pass (component tests, `ledger-snapshot`, `rate-limit`, `mfa`, `validation`, action tests) — identical results to pre-move, since no logic changed.

- [ ] **Step 3: Start local Supabase and run integration tests**

```bash
cd apps/api && supabase start && cd ../..
npm run test:integration
```
Expected: all integration tests pass (`rpc-*.test.ts`, `webhook-*.test.ts`, `schema.test.ts`, `audit-log.test.ts`) — these import `@/lib/supabase/admin` and `@/app/api/webhooks/stripe/route` from `apps/web`, resolved via `apps/web`'s own `tsconfig.json`/`vitest.integration.config.ts` `@/*` alias, against the Supabase instance now running from `apps/api`.

- [ ] **Step 4: Install Playwright browsers and run e2e tests**

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```
If `npx playwright` at the repo root fails to resolve the binary (workspace hoisting edge case), retry with:
```bash
npm exec -w apps/web -- playwright install --with-deps chromium
```
Expected: e2e specs (`auth`, `critical-path`, `mfa`, `smoke`) pass. Playwright's `webServer` config (`apps/web/playwright.config.ts`) spawns `npm run dev` with cwd `apps/web`, which resolves to `apps/web/package.json`'s own `next dev` — no dependency on the root dispatcher for this part.

- [ ] **Step 5: Stop the local Supabase stack**

```bash
cd apps/api && supabase stop && cd ../..
```

- [ ] **Step 6: Confirm `render.yaml` is untouched and the final tree matches the design**

```bash
git diff --stat render.yaml
git status
ls apps/web apps/api/supabase
```
Expected: `git diff --stat render.yaml` prints nothing (zero changes); `git status` shows a clean tree (everything committed, only `apps/web/.env.local` — gitignored — as untracked, if left over); `apps/web` contains `app/`, `components/`, `lib/`, `types/`, `public/`, `tests/`, and the config files from Task 2; `apps/api/supabase` contains `migrations/` and `config.toml`.

- [ ] **Step 7: Commit any fixes discovered during verification** (skip this step if Steps 2-6 all passed with no edits)

```bash
git add -A
git commit -m "Fix path/config issue found during post-restructure verification"
```
