# Monorepo restructure: apps/web + apps/api

## Context

The codebase is currently a single Next.js 16 App Router project at the repo
root. There is no standalone backend server — every server-side concern is
either a Next.js Route Handler / Server Component / middleware, or a Postgres
RPC function running on managed Supabase infrastructure (`supabase/migrations/`).
`render.yaml` deploys exactly one service.

Goal: reorganize into a professional `apps/web` + `apps/api` layout without
changing behavior, and without breaking the single-deployable architecture
that actually exists today.

## Decision

- **`apps/web`** = the entire Next.js app: routes, UI, middleware, Route
  Handlers, and all tests. Next.js can't be split across "frontend" and
  "backend" halves — routing, SSR auth, and API routes are inseparable parts
  of one app — so the whole thing moves as a unit.
- **`apps/api`** = the Supabase backend: SQL migrations, RLS policies, RPC
  functions, `config.toml`. This is the actual backend logic (double-entry
  ledger, transfer/deposit/withdrawal RPCs, KYC state machine) and it is
  genuinely independent of the frontend.
- **Tooling**: npm workspaces (`"workspaces": ["apps/*"]` at the root). No
  Turborepo/pnpm — npm is already in use, workspaces add zero new
  dependencies, and root scripts can dispatch to `apps/web` so `render.yaml`
  needs no changes.

Verified during investigation: every current "integration" test
(`tests/integration/rpc-*.test.ts`, `tests/integration/webhook-*.test.ts`)
imports `@/lib/supabase/admin` or `@/app/api/webhooks/stripe/route` directly —
they test the Next.js app's server code, not standalone backend code. They
stay under `apps/web/tests/`, not `apps/api`.

## Target layout

```
apps/
  web/
    app/                      (all routes, incl. (auth)/, api/webhooks/stripe/)
    components/                ui/, wallet/
    lib/                       auth/, stripe/, supabase/, validation/, wallet/, format.ts, logger.ts, rate-limit.ts, utils.ts
    types/                     supabase.ts (generated DB types; only consumer is web code)
    tests/                     unit/, integration/, e2e/
    public/
    middleware.ts
    next.config.ts
    instrumentation.ts
    instrumentation-client.ts
    sentry.edge.config.ts
    sentry.server.config.ts
    components.json
    eslint.config.mjs
    postcss.config.mjs
    tsconfig.json
    vitest.config.ts
    vitest.integration.config.ts
    playwright.config.ts
    package.json               (today's package.json content, deps unchanged)
    .env.example
  api/
    supabase/
      migrations/*.sql
      config.toml
      .gitignore
package.json                   (new: workspaces + dispatcher scripts)
package-lock.json
render.yaml
README.md
AGENTS.md
CLAUDE.md
docs/
.github/workflows/ci.yml
.gitignore
```

## Config changes required (not just file moves)

| File | Change |
|---|---|
| Root `package.json` (new) | `"workspaces": ["apps/*"]`; scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`) each dispatch via `npm run <script> -w apps/web` |
| `apps/web/package.json` | Current root `package.json`, moved as-is (name field only change, e.g. `"web"`) |
| `.gitignore` | Patterns are root-anchored (`/node_modules`, `/.next/`, `/coverage`, `/test-results/`, `/playwright-report/`, `/out/`, `/build`) — unanchor them (drop leading `/`) so they match inside `apps/web/` |
| `eslint.config.mjs` | Drop the `supabase/.temp/**` ignore — that path no longer exists under `apps/web` |
| `.github/workflows/ci.yml` | `supabase start` step needs `working-directory: apps/api`; the `.env.local` write step needs to target `apps/web/.env.local` |
| `render.yaml` | **No change** — dispatcher scripts keep `npm ci && npm run build` / `npm run start` working from the root |
| `tsconfig.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts` | Move as-is — all path aliases (`@/*`, `__dirname`-relative) stay correct because everything they reference moves together |

`apps/api` gets no `package.json` — it has no JS/TS, just SQL and Supabase
CLI config, which only needs a directory literally named `supabase/` at
whatever cwd the `supabase` CLI is invoked from.

## Out of scope

Pure structural move. No dependency upgrades, no logic changes, no file
splitting, no renames beyond what's needed to make imports resolve. Only
import paths and the config files listed above change.

## Migration mechanics

- `git mv` for every file, to preserve history/blame
- Incremental commits (scaffold → move web → move api → fix root
  package.json/workspaces → fix `.gitignore`/eslint → fix CI), not one
  unreviewable commit
- Full verification before considering this done: `npm install`, `lint`,
  `typecheck`, `build`, unit tests, integration tests (local Supabase via
  Docker), e2e tests (Playwright)

## Risks

- **npm workspace hoisting**: dependencies may hoist to root `node_modules`;
  `npx playwright install` and other tool resolution needs to be re-verified
  post-move (covered by the verification pass).
- **CI working-directory drift**: any CI step reading `.env.local` or
  invoking `supabase` needs the right `working-directory` — missed ones will
  surface immediately as CI/verification failures, not silent breakage.
- **Reversibility**: everything is local `git mv` + config edits on a branch;
  fully revertible via `git reset`/`git checkout` if verification fails.
