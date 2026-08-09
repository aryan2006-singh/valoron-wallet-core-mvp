# Valoron Wallet Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Valoron Wallet core MVP — a fiat ledger wallet (Next.js + Supabase + Stripe) where users sign up with mandatory MFA, verify identity via Stripe Identity, deposit real money, send it to other users, and withdraw it back out, with a correct double-entry ledger and security fundamentals built in from day one.

**Architecture:** Next.js (App Router) on Vercel handles UI, server actions, and the Stripe webhook endpoint. Supabase Postgres holds an append-only double-entry ledger that can only be mutated through `SECURITY DEFINER` RPC functions (row-locked, idempotent). Supabase Auth handles login + mandatory TOTP MFA. Stripe handles deposits (PaymentIntents), withdrawals (Payouts), and KYC (Identity), all reconciled through one signature-verified, deduped webhook endpoint.

**Tech Stack:** Next.js 14 (App Router, TypeScript), Tailwind CSS + shadcn/ui, Supabase (Postgres, Auth, Realtime), Stripe (Payments, Identity), Upstash Redis (rate limiting), Zod, Vitest, Playwright, Sentry, pino (structured logging), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-09-valoron-wallet-core-mvp-design.md`

## Global Constraints

- TypeScript end-to-end; every external input validated with Zod, client and server side.
- Every table has RLS enabled, default-deny. No client role gets INSERT/UPDATE/DELETE on `ledger_entries` or `transactions` — only `SECURITY DEFINER` RPC functions may write to them.
- The Supabase **service-role key is used in exactly one place**: the Stripe webhook route (`app/api/webhooks/stripe/route.ts`). No other file may import `lib/supabase/admin.ts`.
- MFA (TOTP, Supabase AAL2) is required before `transfer_funds` or `record_withdrawal` will succeed — the two RPCs a user directly triggers to move money *out* of their own control — enforced **inside the Postgres function itself**, not only in the UI. It's deliberately not checked on `record_deposit`/`confirm_withdrawal`/`reverse_withdrawal`, which only ever run in the trusted webhook's service-role context (no user session to check an AAL claim against) and only ever move money the user's way or back to where it started.
- All schema changes are version-controlled SQL migration files under `supabase/migrations/`, applied via the Supabase CLI — never manual dashboard edits.
- Stripe webhook events are signature-verified and deduplicated via `webhook_events` before any side effect runs.
- Single currency (USD), one wallet account per user, amounts always stored as integer cents (`amount_cents`, `bigint`), never floats.
- Pre-KYC cumulative cap: $100 (`10000` cents) in deposits/transfers before `kyc_status = 'verified'` is required for withdrawal.
- CI (GitHub Actions) runs lint, typecheck, unit tests, and e2e tests on every PR; merges are gated on passing CI.
- Sentry captures errors in both the Next.js app and the webhook handler.
- Idempotency keys for `transfer_funds`/`record_withdrawal` are generated once per server-action invocation and reused for both the RPC call and any same-invocation Stripe API call — this protects against Stripe SDK-level request retries and against Stripe webhook redelivery (the deposit key is generated once at PaymentIntent creation and persisted in Stripe metadata, so every webhook delivery for that event reuses it). It does **not** dedupe two separate user-initiated submissions (e.g. two real button clicks); that's handled at the UI layer by disabling the submit button while a request is pending. A second click after the first request completes is a legitimate new transaction, not a duplicate — this is an intentional scope boundary, not an oversight.
- Error display convention: money-moving forms (Task 14's send-money page) use shadcn's `toast()` (mounted globally in Task 1) per the design spec's UX section. Forms with a single tightly-scoped field right next to the error (Task 9's MFA code entry, Task 8's inline field validation) keep inline text next to that field, which is the more standard pattern for single-field validation feedback — that's a deliberate convention choice, not an inconsistency. If you're implementing Task 12 (deposit) or Task 13 (withdraw) and want visual consistency with Task 14, swap their inline `{error && <p>...}` blocks for the same `useToast()` pattern; nothing in those tasks' RPC/action logic changes either way.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `.prettierrc`, `.env.example`, `.gitignore`
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Create: `vitest.config.ts`, `tests/unit/smoke.test.ts`
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`
- Create: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Create: `lib/logger.ts`

**Interfaces:**
- Produces: a running Next.js app (`npm run dev`), a passing unit test command (`npm run test:unit`), a passing e2e smoke test command (`npm run test:e2e`), and lint/typecheck commands (`npm run lint`, `npm run typecheck`) that later tasks and CI both call. Also produces `logger` (a configured pino instance, from `lib/logger.ts`) — Task 10's webhook route and Tasks 12-14's server actions import this for structured server-side logging (Sentry is for exception tracking; `logger` is for the normal-operation audit trail of what happened, e.g. "deposit webhook processed for account X").

- [ ] **Step 1: Scaffold the Next.js app**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm
```
When prompted, accept defaults. This creates `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.eslintrc.json`.

- [ ] **Step 2: Add shadcn/ui**

Run:
```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input label badge skeleton toast dialog form
```
This creates `components/ui/*` and updates `tailwind.config.ts` with the shadcn theme tokens.

- [ ] **Step 3: Install remaining dependencies**

Run:
```bash
npm install @supabase/supabase-js @supabase/ssr stripe @stripe/stripe-js zod @upstash/ratelimit @upstash/redis @sentry/nextjs pino
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @playwright/test prettier dotenv
```

- [ ] **Step 4: Configure Vitest**

Create `tests/unit/setup.ts` — registers the `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`) globally for every unit test:
```ts
import '@testing-library/jest-dom/vitest'
```

Create `vitest.config.ts`:
```ts
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
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Create `tests/unit/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Add to `package.json` scripts: `"test:unit": "vitest run"`, `"typecheck": "tsc --noEmit"`.

- [ ] **Step 5: Run the unit smoke test to verify the harness works**

Run: `npm run test:unit`
Expected: PASS (1 test)

- [ ] **Step 6: Configure Playwright**

Run: `npx playwright install --with-deps chromium`

Create `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:3000' },
})
```

Create `tests/e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('home page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Valoron/i)
})
```

Update `app/layout.tsx`: set the metadata title to `"Valoron Wallet"`, and mount shadcn's toaster once at the root so any page can call `toast()` (installed as part of the `toast` component in Step 2):
```tsx
import { Toaster } from '@/components/ui/toaster'
// ...inside the root layout's <body>, alongside {children}:
// <Toaster />
```

Add to `package.json` scripts: `"test:e2e": "playwright test"`.

- [ ] **Step 7: Run the e2e smoke test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS (1 test)

- [ ] **Step 8: Wire up Sentry**

Run:
```bash
npx @sentry/wizard@latest -i nextjs --saas --org <org-slug> --project <project-slug>
```
If running non-interactively isn't possible in this environment, instead hand-create minimal configs:

`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`:
```ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
})
```

Add `NEXT_PUBLIC_SENTRY_DSN=` to `.env.example`.

- [ ] **Step 9: Add the structured logger**

Create `lib/logger.ts`:
```ts
import pino from 'pino'

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { service: 'valoron-wallet' },
})
```

- [ ] **Step 10: Create `.env.example` with every env var this project will need**

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_SENTRY_DSN=
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, shadcn/ui, Vitest, Playwright, Sentry, and pino logger"
```

---

## Task 2: Supabase local dev wiring + typed client wrappers

**Files:**
- Create: `supabase/config.toml` (via CLI init)
- Create: `types/supabase.ts`
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Test: `tests/unit/supabase-admin-import.test.ts`

**Interfaces:**
- Produces: `createClient()` (browser, from `lib/supabase/client.ts`), `createClient()` (server, async, from `lib/supabase/server.ts`), `createAdminClient()` (from `lib/supabase/admin.ts`) — every later task that touches the database imports one of these three.

- [ ] **Step 1: Install and initialize the Supabase CLI**

Run:
```bash
npm install -D supabase
npx supabase init
npx supabase login
npx supabase start
```
`supabase start` prints local API URL, anon key, and service_role key — copy them into a local `.env.local` (not committed) matching `.env.example`.

- [ ] **Step 2: Create a placeholder `Database` type**

Create `types/supabase.ts`:
```ts
// Regenerated from the real schema at the end of Task 4 via:
//   npx supabase gen types typescript --local > types/supabase.ts
// This placeholder just unblocks Task 2's client wrappers.
export type Database = {
  public: {
    Tables: Record<string, { Row: Record<string, unknown> }>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
  }
}
```

- [ ] **Step 3: Write the browser client**

Create `lib/supabase/client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4: Write the server client**

Create `lib/supabase/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
```

- [ ] **Step 5: Write the admin client, with a guard test that it's imported nowhere it shouldn't be**

Create `lib/supabase/admin.ts`:
```ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

/**
 * SECURITY: This client uses the service-role key and bypasses ALL Row
 * Level Security. Per the project's security baseline, it must be
 * imported ONLY from app/api/webhooks/stripe/route.ts. Do not import
 * this from any page, component, or other server action.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

Create `tests/unit/supabase-admin-import.test.ts` — a static guard that fails CI if a forbidden file imports the admin client:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const ALLOWED_IMPORTERS = ['app/api/webhooks/stripe/route.ts']

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (['node_modules', '.next', '.git', 'tests'].includes(entry)) continue
    if (statSync(full).isDirectory()) walk(full, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

describe('supabase admin client import guard', () => {
  it('is only imported from the Stripe webhook route', () => {
    const root = path.resolve(__dirname, '../..')
    const offenders = walk(root)
      .filter((f) => f !== path.join(root, 'lib/supabase/admin.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes("from '@/lib/supabase/admin'"))
      .map((f) => path.relative(root, f).replace(/\\/g, '/'))
      .filter((relPath) => !ALLOWED_IMPORTERS.includes(relPath))

    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 6: Run the guard test to verify it passes with no importers yet**

Run: `npm run test:unit`
Expected: PASS — no files import `lib/supabase/admin` yet, so the offenders list is empty.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Supabase local dev setup and typed client wrappers"
```

---

## Task 3: Core ledger schema migration

**Files:**
- Create: `supabase/migrations/<timestamp>_core_ledger_schema.sql`
- Create: `vitest.integration.config.ts`
- Test: `tests/integration/schema.test.ts`
- Modify: `package.json` (add `test:integration` script)

**Interfaces:**
- Produces: tables `profiles(id, full_name, kyc_status, created_at)`, `accounts(id, user_id, currency, created_at)`, `transactions(id, type, status, initiated_by, stripe_reference, idempotency_key, created_at, updated_at)`, `ledger_entries(id, account_id, transaction_id, amount_cents, direction, balance_after_cents, created_at)`. A trigger `on_auth_user_created` auto-creates a `profiles` + `accounts` row for every new `auth.users` row. Task 5/6's RPC functions write to `transactions` and `ledger_entries`; Task 8's signup flow relies on the trigger.

- [ ] **Step 1: Add an integration test config (these tests run against the real local Supabase stack, unlike Task 1's unit tests)**

Create `tests/integration/setup.ts` — loads `.env.local` into `process.env` before any test file runs, since Vitest (unlike Next.js) does not do this automatically:
```ts
import { config } from 'dotenv'
import path from 'path'

config({ path: path.resolve(__dirname, '../../.env.local') })
```

Create `vitest.integration.config.ts`:
```ts
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
```

Add to `package.json` scripts: `"test:integration": "vitest run --config vitest.integration.config.ts"`.

Make sure `.env.local` (created in Task 2 Step 1 from `supabase start` output) also has placeholder values for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` — Task 10 depends on them being present for its integration tests. Any non-empty string works for local testing; Stripe test-mode keys are used once Task 10 introduces real Stripe calls.

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/schema.test.ts`:
```ts
// Requires the local Supabase stack running: `npx supabase start`
import { describe, it, expect } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

const anon = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const admin = createAdminClient()

describe('core ledger schema', () => {
  it('auto-creates a profile and a USD account when a user signs up', async () => {
    const email = `schema-test-${Date.now()}@example.com`
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: 'Test1234!',
      email_confirm: true,
    })
    expect(createError).toBeNull()
    const userId = created.user!.id

    const { data: profile } = await admin
      .from('profiles')
      .select('id, kyc_status')
      .eq('id', userId)
      .single()
    expect(profile?.kyc_status).toBe('unverified')

    const { data: account } = await admin
      .from('accounts')
      .select('user_id, currency')
      .eq('user_id', userId)
      .single()
    expect(account?.currency).toBe('USD')
  })

  it('blocks anonymous selects on ledger_entries (RLS default-deny)', async () => {
    const { data, error } = await anon.from('ledger_entries').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('blocks anonymous inserts into ledger_entries', async () => {
    const { error } = await anon.from('ledger_entries').insert({
      account_id: '00000000-0000-0000-0000-000000000000',
      transaction_id: '00000000-0000-0000-0000-000000000000',
      amount_cents: 100,
      direction: 'credit',
      balance_after_cents: 100,
    })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `relation "public.profiles" does not exist` (or similar), since the migration hasn't been written yet.

- [ ] **Step 4: Write the migration**

Run: `npx supabase migration new core_ledger_schema` (creates the timestamped file), then fill it in:

```sql
-- profiles: one row per authenticated user
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  kyc_status text not null default 'unverified'
    check (kyc_status in ('unverified','pending','verified','rejected')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Column-level grant: RLS above only filters *rows*, so without this a
-- user could still update their own kyc_status column directly. Only
-- full_name is client-writable; kyc_status changes only via the
-- request_kyc_verification RPC (Task 11) or the service role (webhook).
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- accounts: exactly one wallet per user for this MVP
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

create policy "accounts_select_own" on public.accounts
  for select using (auth.uid() = user_id);

-- transactions: one row per logical money movement
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('p2p_transfer','deposit','withdrawal')),
  status text not null default 'pending'
    check (status in ('pending','completed','failed','reversed')),
  initiated_by uuid references public.profiles(id),
  stripe_reference text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

-- ledger_entries: append-only double-entry rows
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id),
  transaction_id uuid not null references public.transactions(id),
  amount_cents bigint not null check (amount_cents > 0),
  direction text not null check (direction in ('credit','debit')),
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  created_at timestamptz not null default now()
);

alter table public.ledger_entries enable row level security;

create policy "ledger_entries_select_own" on public.ledger_entries
  for select using (
    exists (
      select 1 from public.accounts a
      where a.id = ledger_entries.account_id and a.user_id = auth.uid()
    )
  );

create policy "transactions_select_own" on public.transactions
  for select using (
    exists (
      select 1 from public.ledger_entries le
      join public.accounts a on a.id = le.account_id
      where le.transaction_id = transactions.id and a.user_id = auth.uid()
    )
  );

-- Defense in depth: no INSERT/UPDATE/DELETE policies exist above for
-- ledger_entries/transactions/accounts, but explicitly revoke the grants
-- too, so a future accidental permissive policy still can't be exploited
-- by the client roles.
revoke insert, update, delete on public.transactions from authenticated, anon;
revoke insert, update, delete on public.ledger_entries from authenticated, anon;
revoke insert, update, delete on public.accounts from authenticated, anon;
revoke insert, delete on public.profiles from authenticated, anon;

-- Auto-create a profile + account when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.accounts (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 5: Apply the migration to the local stack**

Run: `npx supabase db reset`
Expected: migration applies cleanly with no errors.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:integration`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add core ledger schema (profiles, accounts, transactions, ledger_entries)"
```

---

## Task 4: Audit log, webhook dedupe table, and generated types

**Files:**
- Create: `supabase/migrations/<timestamp>_audit_and_webhook_dedupe.sql`
- Test: `tests/integration/audit-log.test.ts`
- Modify: `types/supabase.ts` (regenerated, no longer the placeholder)

**Interfaces:**
- Produces: `audit_log(id, actor_id, action, target_table, target_id, ip_address, user_agent, metadata, created_at)`, `webhook_events(id, type, payload, processed_at)`. Task 10's webhook handler reads/writes `webhook_events`; Task 5/6's RPC functions rely on the audit triggers defined here firing automatically on every insert.
- Consumes: `transactions`, `ledger_entries`, `profiles` from Task 3.

Note: Supabase Auth already writes its own login/logout/password-change audit trail to the internal `auth.audit_log_entries` table — this task's `audit_log` table is scoped to financial mutations and KYC status changes, which is what the spec's security baseline calls out.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/audit-log.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

const anon = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const admin = createAdminClient()

describe('audit log', () => {
  it('logs a transaction insert automatically via trigger', async () => {
    const { data: txn, error } = await admin
      .from('transactions')
      .insert({
        type: 'deposit',
        status: 'completed',
        idempotency_key: `audit-test-${Date.now()}`,
      })
      .select()
      .single()
    expect(error).toBeNull()

    const { data: logs } = await admin
      .from('audit_log')
      .select('*')
      .eq('target_table', 'transactions')
      .eq('target_id', txn!.id)
    expect(logs?.length).toBeGreaterThan(0)
  })

  it('blocks anonymous access to audit_log entirely', async () => {
    const { error } = await anon.from('audit_log').select('*')
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `relation "public.audit_log" does not exist`.

- [ ] **Step 3: Write the migration**

Run: `npx supabase migration new audit_and_webhook_dedupe`, then fill it in:

```sql
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_table text not null,
  target_id text not null,
  ip_address inet,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from authenticated, anon;

create table public.webhook_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from authenticated, anon;

create function public.log_financial_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, target_table, target_id, metadata)
  values (
    coalesce(new.initiated_by, auth.uid()),
    tg_op,
    tg_table_name,
    new.id::text,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger audit_transactions_change
  after insert or update on public.transactions
  for each row execute function public.log_financial_mutation();

create trigger audit_ledger_entries_insert
  after insert on public.ledger_entries
  for each row execute function public.log_financial_mutation();

create function public.log_kyc_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kyc_status is distinct from old.kyc_status then
    insert into public.audit_log (actor_id, action, target_table, target_id, metadata)
    values (
      new.id,
      'kyc_status_change',
      'profiles',
      new.id::text,
      jsonb_build_object('from', old.kyc_status, 'to', new.kyc_status)
    );
  end if;
  return new;
end;
$$;

create trigger audit_kyc_status_change
  after update on public.profiles
  for each row execute function public.log_kyc_status_change();
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db reset`
Expected: applies cleanly.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration`
Expected: PASS (2 tests)

- [ ] **Step 6: Regenerate real types, replacing the Task 2 placeholder**

Run:
```bash
npx supabase gen types typescript --local > types/supabase.ts
```

Run `npm run typecheck` to confirm `lib/supabase/client.ts`, `server.ts`, and `admin.ts` still compile against the real generated `Database` type.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add audit log, webhook dedupe table, and generated Supabase types"
```

---

## Task 5: RPC — `transfer_funds`

**Files:**
- Create: `supabase/migrations/<timestamp>_transfer_funds_rpc.sql`
- Create: `tests/integration/helpers/create-verified-user.ts`
- Test: `tests/integration/rpc-transfer-funds.test.ts`

**Interfaces:**
- Consumes: `accounts`, `transactions`, `ledger_entries` from Task 3.
- Produces: RPC `transfer_funds(p_recipient_account_id uuid, p_amount_cents bigint, p_idempotency_key text) returns jsonb` — `{ transaction_id, status }` where `status` is `'completed'` or `'already_processed'`. Callable only by `authenticated` users, infers the sender's account from `auth.uid()`. Task 14 (send-money page) calls this via the user's own session client. The test helper `createVerifiedUser` and `fundAccount` from this task are reused by Task 6 and later integration tests.

This is the highest-stakes function in the app — most of this task's effort goes into the test suite, per the spec's concurrency-safety requirement (§5 of the design doc).

- [ ] **Step 1: Install a TOTP library for tests**

Run: `npm install -D otpauth`

- [ ] **Step 2: Write the shared test helper for creating an MFA-verified test user**

Create `tests/integration/helpers/create-verified-user.ts`:
```ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { TOTP } from 'otpauth'
import { createAdminClient } from '@/lib/supabase/admin'

const admin = createAdminClient()

export async function createVerifiedUser(emailPrefix: string) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const password = 'Test1234!'

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError) throw createError
  const userId = created.user!.id

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError

  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' })
  if (enrollError) throw enrollError

  const totp = new TOTP({ secret: enrollData.totp.secret, digits: 6, period: 30, algorithm: 'SHA1' })
  const { data: challengeData, error: challengeError } = await client.auth.mfa.challenge({
    factorId: enrollData.id,
  })
  if (challengeError) throw challengeError

  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrollData.id,
    challengeId: challengeData.id,
    code: totp.generate(),
  })
  if (verifyError) throw verifyError

  const { data: account } = await admin.from('accounts').select('id').eq('user_id', userId).single()

  return { client, userId, accountId: account!.id as string, email, password }
}

/**
 * Test-only bootstrap: credits an account directly via the admin client,
 * bypassing RLS. This stands in for what Task 6's `record_deposit` RPC
 * will do once it exists — do not use this pattern outside tests.
 */
export async function fundAccount(accountId: string, amountCents: number) {
  const { data: txn } = await admin
    .from('transactions')
    .insert({
      type: 'deposit',
      status: 'completed',
      idempotency_key: `test-fund-${accountId}-${Date.now()}-${Math.random()}`,
    })
    .select()
    .single()

  await admin.from('ledger_entries').insert({
    account_id: accountId,
    transaction_id: txn!.id,
    amount_cents: amountCents,
    direction: 'credit',
    balance_after_cents: amountCents,
  })
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/integration/rpc-transfer-funds.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

describe('transfer_funds RPC', () => {
  it('moves money from sender to recipient', async () => {
    const sender = await createVerifiedUser('sender')
    const recipient = await createVerifiedUser('recipient')
    await fundAccount(sender.accountId, 5000)

    const { data, error } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 2000,
      p_idempotency_key: `transfer-${Date.now()}`,
    })
    expect(error).toBeNull()
    expect(data.status).toBe('completed')

    const { data: entries } = await sender.client
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', sender.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(3000)
  })

  it('rejects a transfer that exceeds the sender balance', async () => {
    const sender = await createVerifiedUser('sender')
    const recipient = await createVerifiedUser('recipient')
    await fundAccount(sender.accountId, 1000)

    const { error } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 5000,
      p_idempotency_key: `transfer-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/insufficient balance/i)
  })

  it('is idempotent: replaying the same key does not double-spend', async () => {
    const sender = await createVerifiedUser('sender')
    const recipient = await createVerifiedUser('recipient')
    await fundAccount(sender.accountId, 5000)
    const key = `transfer-idempotent-${Date.now()}`

    await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 2000,
      p_idempotency_key: key,
    })
    const { data: second } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 2000,
      p_idempotency_key: key,
    })
    expect(second.status).toBe('already_processed')

    const { data: entries } = await sender.client
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', sender.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(3000)
  })

  it('handles two concurrent transfers from the same account without overdrawing it', async () => {
    const sender = await createVerifiedUser('sender')
    const recipientA = await createVerifiedUser('recipientA')
    const recipientB = await createVerifiedUser('recipientB')
    await fundAccount(sender.accountId, 3000) // enough for exactly one of these two 3000 transfers

    const [resultA, resultB] = await Promise.all([
      sender.client.rpc('transfer_funds', {
        p_recipient_account_id: recipientA.accountId,
        p_amount_cents: 3000,
        p_idempotency_key: `concurrent-a-${Date.now()}`,
      }),
      sender.client.rpc('transfer_funds', {
        p_recipient_account_id: recipientB.accountId,
        p_amount_cents: 3000,
        p_idempotency_key: `concurrent-b-${Date.now()}`,
      }),
    ])

    const results = [resultA, resultB]
    expect(results.filter((r) => !r.error).length).toBe(1)
    expect(results.filter((r) => r.error).length).toBe(1)
  })

  it('rejects a transfer when the session has not completed MFA (aal1)', async () => {
    const admin = createAdminClient()
    const email = `no-mfa-${Date.now()}@example.com`
    const password = 'Test1234!'
    await admin.auth.admin.createUser({ email, password, email_confirm: true })

    const client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await client.auth.signInWithPassword({ email, password })

    const recipient = await createVerifiedUser('recipient')
    const { error } = await client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 100,
      p_idempotency_key: `no-mfa-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/mfa/i)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — `could not find function public.transfer_funds`.

- [ ] **Step 5: Write the migration**

Run: `npx supabase migration new transfer_funds_rpc`, then fill it in:

```sql
create or replace function public.transfer_funds(
  p_recipient_account_id uuid,
  p_amount_cents bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_account_id uuid;
  v_sender_balance bigint;
  v_recipient_balance bigint;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'mfa verification required' using errcode = '28000';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  select id into v_existing_transaction_id
  from public.transactions
  where idempotency_key = p_idempotency_key;

  if v_existing_transaction_id is not null then
    return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
  end if;

  select id into v_sender_account_id from public.accounts where user_id = auth.uid();

  if v_sender_account_id is null then
    raise exception 'sender account not found' using errcode = 'P0002';
  end if;

  if v_sender_account_id = p_recipient_account_id then
    raise exception 'cannot transfer to your own account' using errcode = '22023';
  end if;

  if not exists (select 1 from public.accounts where id = p_recipient_account_id) then
    raise exception 'recipient account not found' using errcode = 'P0002';
  end if;

  -- Lock both accounts in a stable order (by id) so two concurrent
  -- transfers touching the same pair of accounts can never deadlock.
  perform 1 from public.accounts
  where id in (v_sender_account_id, p_recipient_account_id)
  order by id
  for update;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_sender_balance
  from public.ledger_entries where account_id = v_sender_account_id;

  if v_sender_balance < p_amount_cents then
    raise exception 'insufficient balance' using errcode = '23514';
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_recipient_balance
  from public.ledger_entries where account_id = p_recipient_account_id;

  insert into public.transactions (type, status, initiated_by, idempotency_key)
  values ('p2p_transfer', 'completed', auth.uid(), p_idempotency_key)
  returning id into v_transaction_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_sender_account_id, v_transaction_id, p_amount_cents, 'debit', v_sender_balance - p_amount_cents);

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (p_recipient_account_id, v_transaction_id, p_amount_cents, 'credit', v_recipient_balance + p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'completed');
end;
$$;

revoke execute on function public.transfer_funds(uuid, bigint, text) from public;
grant execute on function public.transfer_funds(uuid, bigint, text) to authenticated;
```

- [ ] **Step 6: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS (5 tests)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add transfer_funds RPC with row-locking and idempotency"
```

---

## Task 6: RPCs — `record_deposit`, `record_withdrawal`, `confirm_withdrawal`, `reverse_withdrawal`

**Files:**
- Create: `supabase/migrations/<timestamp>_deposit_withdrawal_rpcs.sql`
- Test: `tests/integration/rpc-deposit-withdrawal.test.ts`

**Interfaces:**
- Consumes: `createVerifiedUser`, `fundAccount` helper from Task 5.
- Produces: `record_deposit(p_account_id, p_amount_cents, p_stripe_reference, p_idempotency_key)` (service_role only) — Task 12's webhook handler calls this on `payment_intent.succeeded`. `record_withdrawal(p_amount_cents, p_idempotency_key)` (authenticated, own account inferred from `auth.uid()`) — Task 13's withdraw server action calls this. `confirm_withdrawal(p_transaction_id, p_stripe_reference)` and `reverse_withdrawal(p_transaction_id, p_reason)` (service_role, and — per Step 5 below — also authenticated for a user's own pending withdrawal) — Task 13's webhook branch and withdraw action call these on `payout.paid` / `payout.failed` / a synchronous payout-creation failure.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/rpc-deposit-withdrawal.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

const admin = createAdminClient()

describe('record_deposit RPC', () => {
  it('credits the account and is idempotent', async () => {
    const user = await createVerifiedUser('depositor')
    const key = `deposit-${Date.now()}`

    const { data, error } = await admin.rpc('record_deposit', {
      p_account_id: user.accountId,
      p_amount_cents: 4000,
      p_stripe_reference: 'pi_test_123',
      p_idempotency_key: key,
    })
    expect(error).toBeNull()
    expect(data.status).toBe('completed')

    const { data: replay } = await admin.rpc('record_deposit', {
      p_account_id: user.accountId,
      p_amount_cents: 4000,
      p_stripe_reference: 'pi_test_123',
      p_idempotency_key: key,
    })
    expect(replay.status).toBe('already_processed')

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(4000)
  })

  it('cannot be called by an authenticated (non-service-role) client', async () => {
    const user = await createVerifiedUser('depositor')
    const { error } = await user.client.rpc('record_deposit', {
      p_account_id: user.accountId,
      p_amount_cents: 1000,
      p_stripe_reference: 'pi_test_456',
      p_idempotency_key: `deposit-${Date.now()}`,
    })
    expect(error).not.toBeNull()
  })
})

describe('record_withdrawal / confirm_withdrawal / reverse_withdrawal RPCs', () => {
  it('debits as pending, then confirm_withdrawal completes it', async () => {
    const user = await createVerifiedUser('withdrawer')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)

    const { data: withdrawal, error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).toBeNull()
    expect(withdrawal.status).toBe('pending')

    const { data: confirmed } = await admin.rpc('confirm_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_stripe_reference: 'po_test_123',
    })
    expect(confirmed.status).toBe('completed')
  })

  it('reverse_withdrawal credits the money back and marks the transaction reversed', async () => {
    const user = await createVerifiedUser('withdrawer')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)

    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 4000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    await admin.rpc('reverse_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_reason: 'payout_failed',
    })

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(10000)
  })

  it('lets a user reverse (cancel) their own pending withdrawal directly', async () => {
    const user = await createVerifiedUser('self-canceller')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)

    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 4000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const { data: reversed, error } = await user.client.rpc('reverse_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_reason: 'user_cancelled',
    })
    expect(error).toBeNull()
    expect(reversed.status).toBe('reversed')
  })

  it('blocks a user from reversing someone else\'s pending withdrawal', async () => {
    const owner = await createVerifiedUser('withdrawal-owner')
    const intruder = await createVerifiedUser('withdrawal-intruder')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', owner.userId)
    await fundAccount(owner.accountId, 10000)

    const { data: withdrawal } = await owner.client.rpc('record_withdrawal', {
      p_amount_cents: 4000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const { error } = await intruder.client.rpc('reverse_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_reason: 'not_my_withdrawal',
    })
    expect(error).not.toBeNull()
  })

  it('blocks withdrawals over the $100 pre-KYC cap for unverified users', async () => {
    const user = await createVerifiedUser('unverified-withdrawer')
    await fundAccount(user.accountId, 20000)

    const { error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 15000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/kyc/i)
  })

  it('allows a small withdrawal under the pre-KYC cap for unverified users', async () => {
    const user = await createVerifiedUser('small-withdrawer')
    await fundAccount(user.accountId, 20000)

    const { data, error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).toBeNull()
    expect(data.status).toBe('pending')
  })

  it('rejects a withdrawal that exceeds the account balance', async () => {
    const user = await createVerifiedUser('overdrawer')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 1000)

    const { error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/insufficient balance/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — `could not find function public.record_deposit` (etc).

- [ ] **Step 3: Write the migration**

Run: `npx supabase migration new deposit_withdrawal_rpcs`, then fill it in:

```sql
create or replace function public.record_deposit(
  p_account_id uuid,
  p_amount_cents bigint,
  p_stripe_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
begin
  if p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  select id into v_existing_transaction_id from public.transactions where idempotency_key = p_idempotency_key;
  if v_existing_transaction_id is not null then
    return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
  end if;

  perform 1 from public.accounts where id = p_account_id for update;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_balance
  from public.ledger_entries where account_id = p_account_id;

  insert into public.transactions (type, status, stripe_reference, idempotency_key)
  values ('deposit', 'completed', p_stripe_reference, p_idempotency_key)
  returning id into v_transaction_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (p_account_id, v_transaction_id, p_amount_cents, 'credit', v_balance + p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'completed');
end;
$$;

revoke execute on function public.record_deposit(uuid, bigint, text, text) from public, authenticated, anon;
grant execute on function public.record_deposit(uuid, bigint, text, text) to service_role;

create or replace function public.record_withdrawal(
  p_amount_cents bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_balance bigint;
  v_kyc_status text;
  v_prior_withdrawn bigint;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'mfa verification required' using errcode = '28000';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  select id into v_existing_transaction_id from public.transactions where idempotency_key = p_idempotency_key;
  if v_existing_transaction_id is not null then
    return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
  end if;

  select a.id, p.kyc_status into v_account_id, v_kyc_status
  from public.accounts a
  join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid();

  if v_account_id is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  if v_kyc_status <> 'verified' then
    select coalesce(sum(le.amount_cents), 0) into v_prior_withdrawn
    from public.ledger_entries le
    join public.transactions t on t.id = le.transaction_id
    where le.account_id = v_account_id and t.type = 'withdrawal' and t.status in ('pending', 'completed');

    if v_prior_withdrawn + p_amount_cents > 10000 then
      raise exception 'kyc verification required for this withdrawal amount' using errcode = '28000';
    end if;
  end if;

  perform 1 from public.accounts where id = v_account_id for update;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_balance
  from public.ledger_entries where account_id = v_account_id;

  if v_balance < p_amount_cents then
    raise exception 'insufficient balance' using errcode = '23514';
  end if;

  insert into public.transactions (type, status, initiated_by, idempotency_key)
  values ('withdrawal', 'pending', auth.uid(), p_idempotency_key)
  returning id into v_transaction_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_account_id, v_transaction_id, p_amount_cents, 'debit', v_balance - p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'pending', 'account_id', v_account_id);
end;
$$;

revoke execute on function public.record_withdrawal(bigint, text) from public;
grant execute on function public.record_withdrawal(bigint, text) to authenticated;

create or replace function public.confirm_withdrawal(
  p_transaction_id uuid,
  p_stripe_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.transactions
  set status = 'completed', stripe_reference = p_stripe_reference, updated_at = now()
  where id = p_transaction_id and type = 'withdrawal' and status = 'pending';

  if not found then
    raise exception 'no matching pending withdrawal transaction' using errcode = 'P0002';
  end if;

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'completed');
end;
$$;

revoke execute on function public.confirm_withdrawal(uuid, text) from public, authenticated, anon;
grant execute on function public.confirm_withdrawal(uuid, text) to service_role;

create or replace function public.reverse_withdrawal(
  p_transaction_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_amount_cents bigint;
  v_balance bigint;
  v_initiated_by uuid;
begin
  select le.account_id, le.amount_cents, t.initiated_by
  into v_account_id, v_amount_cents, v_initiated_by
  from public.ledger_entries le
  join public.transactions t on t.id = le.transaction_id
  where le.transaction_id = p_transaction_id and t.type = 'withdrawal' and t.status = 'pending'
  limit 1;

  if v_account_id is null then
    raise exception 'no matching pending withdrawal transaction' using errcode = 'P0002';
  end if;

  -- A real user session (auth.uid() is set) may only reverse/cancel their
  -- own pending withdrawal — this covers a synchronous Stripe payout
  -- failure inside the withdraw server action. A service-role call (no
  -- auth.uid(), i.e. the webhook) may reverse any pending withdrawal —
  -- this covers an async payout.failed event arriving later.
  if auth.uid() is not null and auth.uid() <> v_initiated_by then
    raise exception 'not authorized to reverse this transaction' using errcode = '42501';
  end if;

  perform 1 from public.accounts where id = v_account_id for update;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_balance
  from public.ledger_entries where account_id = v_account_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_account_id, p_transaction_id, v_amount_cents, 'credit', v_balance + v_amount_cents);

  update public.transactions set status = 'reversed', updated_at = now() where id = p_transaction_id;

  insert into public.audit_log (action, target_table, target_id, metadata)
  values ('withdrawal_reversed', 'transactions', p_transaction_id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'reversed');
end;
$$;

revoke execute on function public.reverse_withdrawal(uuid, text) from public;
grant execute on function public.reverse_withdrawal(uuid, text) to authenticated, service_role;
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add deposit/withdrawal RPCs with pre-KYC cap and reversal support"
```

---

## Task 7: Shared libs — Zod validation schemas and rate limiter

**Files:**
- Create: `lib/validation/wallet.ts`
- Create: `lib/validation/auth.ts`
- Create: `lib/rate-limit.ts`
- Test: `tests/unit/validation.test.ts`
- Test: `tests/unit/rate-limit.test.ts`
- Modify: `vitest.config.ts` (add dummy Upstash env vars so module import doesn't throw)

**Interfaces:**
- Produces: `transferSchema`, `depositSchema`, `withdrawalSchema` (from `lib/validation/wallet.ts`), `signUpSchema` (from `lib/validation/auth.ts`) — Zod schemas with inferred `TransferInput`/`DepositInput`/`WithdrawalInput`/`SignUpInput` types. `loginRateLimit`, `transferRateLimit`, `withdrawalRateLimit`, and `enforceRateLimit(limiter, identifier): Promise<boolean>` from `lib/rate-limit.ts`. Tasks 8, 12, 13, 14 import these directly.

- [ ] **Step 1: Add dummy Upstash env vars for unit tests**

Modify `vitest.config.ts`, adding a `test.env` block:
```ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    env: {
      UPSTASH_REDIS_REST_URL: 'https://example-test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 2: Write the failing validation tests**

Create `tests/unit/validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { transferSchema, depositSchema, withdrawalSchema } from '@/lib/validation/wallet'
import { signUpSchema } from '@/lib/validation/auth'

describe('transferSchema', () => {
  it('accepts a valid transfer', () => {
    const result = transferSchema.safeParse({ recipientEmail: 'a@b.com', amountCents: 2000 })
    expect(result.success).toBe(true)
  })
  it('rejects a non-positive amount', () => {
    expect(transferSchema.safeParse({ recipientEmail: 'a@b.com', amountCents: 0 }).success).toBe(false)
  })
  it('rejects an invalid email', () => {
    expect(transferSchema.safeParse({ recipientEmail: 'not-an-email', amountCents: 100 }).success).toBe(false)
  })
})

describe('depositSchema', () => {
  it('rejects a deposit below the $1 minimum', () => {
    expect(depositSchema.safeParse({ amountCents: 50 }).success).toBe(false)
  })
})

describe('withdrawalSchema', () => {
  it('rejects a withdrawal below the $1 minimum', () => {
    expect(withdrawalSchema.safeParse({ amountCents: 50 }).success).toBe(false)
  })
})

describe('signUpSchema', () => {
  it('rejects a weak password', () => {
    expect(
      signUpSchema.safeParse({ email: 'a@b.com', password: 'short', fullName: 'A' }).success
    ).toBe(false)
  })
  it('accepts a strong password', () => {
    expect(
      signUpSchema.safeParse({ email: 'a@b.com', password: 'Str0ngPassword!', fullName: 'A' }).success
    ).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `@/lib/validation/wallet`.

- [ ] **Step 4: Implement the validation schemas**

Create `lib/validation/wallet.ts`:
```ts
import { z } from 'zod'

export const transferSchema = z.object({
  recipientEmail: z.string().email('Enter a valid email address'),
  amountCents: z.number().int().positive().max(1_000_000), // $10,000 cap per transfer
})
export type TransferInput = z.infer<typeof transferSchema>

export const depositSchema = z.object({
  amountCents: z.number().int().min(100, 'Minimum deposit is $1').max(50_000_000),
})
export type DepositInput = z.infer<typeof depositSchema>

export const withdrawalSchema = z.object({
  amountCents: z.number().int().min(100, 'Minimum withdrawal is $1'),
})
export type WithdrawalInput = z.infer<typeof withdrawalSchema>
```

Create `lib/validation/auth.ts`:
```ts
import { z } from 'zod'

export const signUpSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  fullName: z.string().min(1, 'Full name is required'),
})
export type SignUpInput = z.infer<typeof signUpSchema>
```

- [ ] **Step 5: Run to verify the validation tests pass**

Run: `npm run test:unit`
Expected: PASS (7 tests)

- [ ] **Step 6: Write the failing rate-limit test**

Create `tests/unit/rate-limit.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { enforceRateLimit } from '@/lib/rate-limit'
import type { Ratelimit } from '@upstash/ratelimit'

function fakeLimiter(success: boolean): Ratelimit {
  return {
    limit: async () => ({ success, limit: 5, remaining: success ? 4 : 0, reset: Date.now() }),
  } as unknown as Ratelimit
}

function unreachableLimiter(): Ratelimit {
  return { limit: async () => { throw new Error('fetch failed') } } as unknown as Ratelimit
}

describe('enforceRateLimit', () => {
  it('returns true when the limiter allows the request', async () => {
    expect(await enforceRateLimit(fakeLimiter(true), 'user-1')).toBe(true)
  })
  it('returns false when the limiter denies the request', async () => {
    expect(await enforceRateLimit(fakeLimiter(false), 'user-1')).toBe(false)
  })
  it('fails open (returns true) when the rate limiter itself is unreachable', async () => {
    expect(await enforceRateLimit(unreachableLimiter(), 'user-1')).toBe(true)
  })
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `@/lib/rate-limit`.

- [ ] **Step 8: Implement the rate limiter**

Create `lib/rate-limit.ts`:
```ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import * as Sentry from '@sentry/nextjs'

function createRateLimiter(prefix: string, limit: number, window: `${number} ${'s' | 'm' | 'h'}`) {
  return new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `ratelimit:${prefix}`,
  })
}

// Baseline abuse resistance for this MVP. Burst/DDoS-scale tuning is
// covered by the dedicated Scaling spec.
export const loginRateLimit = createRateLimiter('login', 5, '1 m')
export const transferRateLimit = createRateLimiter('transfer', 10, '1 m')
export const withdrawalRateLimit = createRateLimiter('withdrawal', 5, '1 h')
export const depositRateLimit = createRateLimiter('deposit', 10, '1 h') // card-testing-fraud resistance

export async function enforceRateLimit(limiter: Ratelimit, identifier: string): Promise<boolean> {
  try {
    const result = await limiter.limit(identifier)
    return result.success
  } catch (err) {
    // Fail open: an Upstash outage or network blip must not take the
    // whole app down with it. Still report it — a silent rate-limiter
    // outage is itself a security-relevant blind spot.
    Sentry.captureException(err)
    return true
  }
}
```

- [ ] **Step 9: Run to verify the rate-limit tests pass**

Run: `npm run test:unit`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add Zod validation schemas and Upstash rate limiter"
```

---

## Task 8: Auth — signup/login pages and route protection middleware

**Files:**
- Create: `middleware.ts`
- Create: `app/(auth)/actions.ts`
- Create: `app/(auth)/signup/page.tsx`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/mfa/page.tsx` (placeholder, completed in Task 9)
- Create: `app/dashboard/page.tsx` (placeholder, completed in Task 15)
- Modify: `supabase/config.toml` (disable email confirmation for local dev only)
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `signUpSchema` (Task 7), `loginRateLimit`/`enforceRateLimit` (Task 7), `createClient` server client (Task 2).
- Produces: `signUpAction(formData): Promise<{ error: string } | never>` and `logInAction(formData): Promise<{ error: string } | never>` (both redirect on success — `signUpAction` to `/mfa`, `logInAction` to `/dashboard`). `middleware.ts` protects every route except `/`, `/login`, `/signup`, and `/api/webhooks/*`. Task 9 replaces the `/mfa` placeholder; Task 15 replaces the `/dashboard` placeholder.

- [ ] **Step 1: Install form dependencies**

Run: `npm install react-hook-form @hookform/resolvers`

- [ ] **Step 2: Disable email confirmation for local dev only**

Modify `supabase/config.toml`, under `[auth.email]`, set:
```toml
enable_confirmations = false
```
Add a comment directly above it: `# LOCAL DEV ONLY — production Supabase project settings must keep email confirmation ON.` This is a config-only change (no code) so it needs no test.

- [ ] **Step 3: Write the middleware**

Create `middleware.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/', '/login', '/signup']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublic =
    PUBLIC_PATHS.includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith('/api/webhooks')

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 4: Write the failing e2e test**

Create `tests/e2e/auth.spec.ts`:
```ts
// Requires the local Supabase stack running: `npx supabase start`
import { test, expect } from '@playwright/test'

test('a new user can sign up and is routed to MFA setup', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('Str0ngPassword!')
  await page.getByRole('button', { name: /sign up/i }).click()
  await expect(page).toHaveURL(/\/mfa/)
})

test('an unauthenticated user is redirected away from the dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `/signup` and `/dashboard` don't exist yet (404).

- [ ] **Step 6: Write the server actions**

Create `app/(auth)/actions.ts`:
```ts
'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signUpSchema } from '@/lib/validation/auth'
import { loginRateLimit, enforceRateLimit } from '@/lib/rate-limit'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })

export async function signUpAction(formData: FormData): Promise<{ error: string } | void> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  })
  if (error) return { error: error.message }

  redirect('/mfa')
}

export async function logInAction(formData: FormData): Promise<{ error: string } | void> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: 'Enter a valid email and password' }

  const ip = (await headers()).get('x-forwarded-for') ?? 'unknown'
  const allowed = await enforceRateLimit(loginRateLimit, `${ip}:${parsed.data.email}`)
  if (!allowed) return { error: 'Too many login attempts. Try again in a minute.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: 'Invalid email or password' }

  redirect('/dashboard')
}
```

- [ ] **Step 7: Write the signup page**

Create `app/(auth)/signup/page.tsx`:
```tsx
'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { signUpSchema, type SignUpInput } from '@/lib/validation/auth'
import { signUpAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SignUpPage() {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', fullName: '' },
  })

  function onSubmit(values: SignUpInput) {
    setServerError(null)
    const formData = new FormData()
    formData.set('email', values.email)
    formData.set('password', values.password)
    formData.set('fullName', values.fullName)
    startTransition(async () => {
      const result = await signUpAction(formData)
      if (result?.error) setServerError(result.error)
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your Valoron account</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Creating account…' : 'Sign up'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 8: Write the login page**

Create `app/(auth)/login/page.tsx`:
```tsx
'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { logInAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
type LoginInput = z.infer<typeof loginSchema>

export default function LoginPage() {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  function onSubmit(values: LoginInput) {
    setServerError(null)
    const formData = new FormData()
    formData.set('email', values.email)
    formData.set('password', values.password)
    startTransition(async () => {
      const result = await logInAction(formData)
      if (result?.error) setServerError(result.error)
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in to Valoron</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Logging in…' : 'Log in'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 9: Create the `/mfa` and `/dashboard` placeholders**

Create `app/mfa/page.tsx`:
```tsx
export default function MfaSetupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-muted-foreground">Two-factor setup — implemented in the next task.</p>
    </div>
  )
}
```

Create `app/dashboard/page.tsx`:
```tsx
export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">Coming soon.</p>
    </div>
  )
}
```

- [ ] **Step 10: Run to verify the e2e tests pass**

Run: `npm run test:e2e`
Expected: PASS (2 tests)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add signup/login pages and route protection middleware"
```

---

## Task 9: MFA enrollment flow and server-side enforcement helper

**Files:**
- Create: `lib/auth/mfa.ts`
- Modify: `app/mfa/page.tsx` (replace Task 8's placeholder)
- Test: `tests/unit/mfa.test.ts`
- Test: `tests/e2e/mfa.spec.ts`

**Interfaces:**
- Consumes: `createClient` server client (Task 2), `createClient` browser client (Task 2).
- Produces: `requireVerifiedMfa(): Promise<{ ok: true; userId: string } | { ok: false; error: string }>` from `lib/auth/mfa.ts` — Tasks 13 and 14's server actions (withdrawal and P2P transfer — the two flows that move money *out* of a user's control) call this before invoking their RPC, as a fast, friendly pre-check (the RPC functions from Task 5/6 re-check `aal2` themselves regardless, so this is defense in depth, not the only gate). Task 12's deposit action deliberately does **not** call this: a deposit only moves the account owner's own money *in*, and `record_deposit` itself is only ever invoked by the trusted webhook (service-role, no user session to check aal2 against) — the MFA gate matters where funds can leave a user's control, which deposits don't.

- [ ] **Step 1: Write the failing unit test for the server-side MFA helper**

Create `tests/unit/mfa.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { requireVerifiedMfa } from '@/lib/auth/mfa'

function mockSupabase(user: { id: string } | null, aal: 'aal1' | 'aal2' | null) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: aal ? { currentLevel: aal } : null,
          error: aal ? null : new Error('no session'),
        }),
      },
    },
  }
}

describe('requireVerifiedMfa', () => {
  it('rejects when there is no authenticated user', async () => {
    ;(createClient as any).mockResolvedValue(mockSupabase(null, null))
    expect((await requireVerifiedMfa()).ok).toBe(false)
  })

  it('rejects when the session is only aal1', async () => {
    ;(createClient as any).mockResolvedValue(mockSupabase({ id: 'u1' }, 'aal1'))
    expect((await requireVerifiedMfa()).ok).toBe(false)
  })

  it('accepts when the session is aal2', async () => {
    ;(createClient as any).mockResolvedValue(mockSupabase({ id: 'u1' }, 'aal2'))
    expect(await requireVerifiedMfa()).toEqual({ ok: true, userId: 'u1' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `@/lib/auth/mfa`.

- [ ] **Step 3: Implement the helper**

Create `lib/auth/mfa.ts`:
```ts
import { createClient } from '@/lib/supabase/server'

export async function requireVerifiedMfa(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data || data.currentLevel !== 'aal2') {
    return { ok: false, error: 'Two-factor verification is required for this action' }
  }
  return { ok: true, userId: user.id }
}
```

- [ ] **Step 4: Run to verify the unit tests pass**

Run: `npm run test:unit`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing e2e test for the full enrollment flow**

Create `tests/e2e/mfa.spec.ts`:
```ts
// Requires the local Supabase stack running: `npx supabase start`
import { test, expect } from '@playwright/test'
import { TOTP } from 'otpauth'

test('a signed-up user can complete MFA enrollment and reach the dashboard', async ({ page }) => {
  const email = `mfa-e2e-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('Str0ngPassword!')
  await page.getByRole('button', { name: /sign up/i }).click()
  await expect(page).toHaveURL(/\/mfa/)

  const secretLocator = page.getByTestId('mfa-manual-key')
  await expect(secretLocator).toBeVisible()
  const secret = (await secretLocator.textContent())!.trim()

  const totp = new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' })
  await page.getByPlaceholder('6-digit code').fill(totp.generate())
  await page.getByRole('button', { name: /verify and continue/i }).click()

  await expect(page).toHaveURL(/\/dashboard/)
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — the placeholder `/mfa` page has no QR code, secret, or verify button.

- [ ] **Step 7: Implement the MFA enrollment page**

Replace `app/mfa/page.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function MfaSetupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      if (factors?.totp.some((f) => f.status === 'verified')) {
        router.replace('/dashboard')
        return
      }
      const unverified = factors?.totp.find((f) => f.status === 'unverified')
      if (unverified) await supabase.auth.mfa.unenroll({ factorId: unverified.id })

      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (error) {
        setError(error.message)
      } else {
        setQrCode(data.totp.qr_code)
        setSecret(data.totp.secret)
        setFactorId(data.id)
      }
      setLoading(false)
    }
    init()
  }, [])

  async function handleVerify() {
    if (!factorId) return
    setError(null)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) {
      setError(challengeError.message)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    })
    if (verifyError) {
      setError('Invalid code — try again.')
      return
    }
    router.replace('/dashboard')
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center">Loading…</div>

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Valoron requires an authenticator app before you can send, deposit, or withdraw money.
          </p>
          {qrCode && (
            <img src={qrCode} alt="Scan this QR code with your authenticator app" className="mx-auto h-40 w-40" />
          )}
          {secret && (
            <p className="text-xs text-muted-foreground">
              Can&apos;t scan? Enter this key manually:{' '}
              <span data-testid="mfa-manual-key" className="font-mono">{secret}</span>
            </p>
          )}
          <Input
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleVerify} className="w-full" disabled={code.length !== 6}>
            Verify and continue
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 8: Run to verify the e2e test passes**

Run: `npm run test:e2e`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add TOTP MFA enrollment flow and server-side AAL2 enforcement helper"
```

---

## Task 10: Stripe foundation — client and webhook route skeleton

**Files:**
- Create: `lib/stripe/client.ts`
- Create: `app/api/webhooks/stripe/route.ts`
- Test: `tests/integration/webhook-route.test.ts`

**Interfaces:**
- Consumes: `logger` (Task 1).
- Produces: `stripe` (configured `Stripe` SDK instance, from `lib/stripe/client.ts`) — every later Stripe-touching task imports this instead of constructing its own instance. `POST` handler at `app/api/webhooks/stripe/route.ts` that verifies signatures, dedupes via `webhook_events` (Task 4), and dispatches on `event.type` through a `switch` with a no-op `default` — Tasks 11, 12, 13 each add one `case` branch and one handler function to this same file, calling `createAdminClient()` (Task 2) which per the Global Constraints is used **only** in this file.

- [ ] **Step 1: Write the Stripe client**

Create `lib/stripe/client.ts`:
```ts
import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/webhook-route.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'

const admin = createAdminClient()

function buildSignedRequest(eventId: string, type = 'test.unhandled_event') {
  const body = JSON.stringify({ id: eventId, type, data: { object: {} } })
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  })
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  })
}

describe('Stripe webhook route', () => {
  it('rejects a request with an invalid signature', async () => {
    const request = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt_bad', type: 'test.event' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('accepts a validly signed event and records it for dedupe', async () => {
    const eventId = `evt_test_${Date.now()}`
    const response = await POST(buildSignedRequest(eventId))
    expect(response.status).toBe(200)

    const { data } = await admin.from('webhook_events').select('id').eq('id', eventId).single()
    expect(data?.id).toBe(eventId)
  })

  it('deduplicates a replayed event instead of reprocessing it', async () => {
    const eventId = `evt_test_${Date.now()}`
    const first = await POST(buildSignedRequest(eventId))
    const second = await POST(buildSignedRequest(eventId))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await second.json()).deduped).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot find module `@/app/api/webhooks/stripe/route`.

- [ ] **Step 4: Implement the webhook route skeleton**

Create `app/api/webhooks/stripe/route.ts`:
```ts
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type Stripe from 'stripe'

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature ?? '', process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    logger.warn({ err }, 'stripe webhook: invalid signature')
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // SECURITY: this is the one file in the app allowed to hold the
  // service-role key — see Global Constraints in this plan's header.
  const admin = createAdminClient()

  const { error: dedupeError } = await admin
    .from('webhook_events')
    .insert({ id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })

  if (dedupeError) {
    if (dedupeError.code === '23505') {
      // Already processed this event id — Stripe retries are expected.
      logger.info({ eventId: event.id, type: event.type }, 'stripe webhook: deduped replayed event')
      return NextResponse.json({ received: true, deduped: true })
    }
    logger.error({ err: dedupeError, eventId: event.id }, 'stripe webhook: failed to record event')
    Sentry.captureException(dedupeError)
    return NextResponse.json({ error: 'Failed to record webhook event' }, { status: 500 })
  }

  logger.info({ eventId: event.id, type: event.type }, 'stripe webhook: processing event')

  try {
    switch (event.type) {
      // Tasks 11-13 add cases here: identity.verification_session.*,
      // payment_intent.succeeded, payout.paid, payout.failed.
      default:
        break
    }
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, 'stripe webhook: handler failed')
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:integration`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Stripe client and webhook route with signature verification and dedupe"
```

---

## Task 11: KYC via Stripe Identity

**Files:**
- Create: `supabase/migrations/<timestamp>_kyc_rpc.sql`
- Create: `app/kyc/actions.ts`
- Create: `app/kyc/page.tsx`
- Modify: `app/api/webhooks/stripe/route.ts` (add 2 cases + 2 handler functions)
- Modify: `.env.example` (add `NEXT_PUBLIC_APP_URL`)
- Test: `tests/integration/rpc-kyc.test.ts`
- Test: `tests/integration/webhook-kyc.test.ts`

**Interfaces:**
- Consumes: `createVerifiedUser` (Task 5), `stripe` client (Task 10), webhook route's dedupe/dispatch skeleton (Task 10).
- Produces: RPC `request_kyc_verification(): jsonb` (authenticated, self only). Server action `startKycVerification(): Promise<{ url: string } | { error: string }>` — redirects the user to Stripe's hosted verification flow. Task 15's Settings page reads `profiles.kyc_status` (already selectable per Task 3's RLS policy) to display current status and links to `/kyc` if unverified.

- [ ] **Step 1: Write the failing RPC test**

Create `tests/integration/rpc-kyc.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser } from './helpers/create-verified-user'

const admin = createAdminClient()

describe('request_kyc_verification RPC', () => {
  it('moves an unverified user to pending', async () => {
    const user = await createVerifiedUser('kyc-applicant')
    const { data, error } = await user.client.rpc('request_kyc_verification')
    expect(error).toBeNull()
    expect(data.kyc_status).toBe('pending')

    const { data: profile } = await admin.from('profiles').select('kyc_status').eq('id', user.userId).single()
    expect(profile?.kyc_status).toBe('pending')
  })

  it('does not move an already-verified user back to pending', async () => {
    const user = await createVerifiedUser('kyc-verified')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)

    await user.client.rpc('request_kyc_verification')

    const { data: profile } = await admin.from('profiles').select('kyc_status').eq('id', user.userId).single()
    expect(profile?.kyc_status).toBe('verified')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `could not find function public.request_kyc_verification`.

- [ ] **Step 3: Write the migration**

Run: `npx supabase migration new kyc_rpc`, then fill it in:
```sql
create or replace function public.request_kyc_verification()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.profiles
  set kyc_status = 'pending'
  where id = auth.uid() and kyc_status in ('unverified', 'rejected');

  return jsonb_build_object('kyc_status', (select kyc_status from public.profiles where id = auth.uid()));
end;
$$;

revoke execute on function public.request_kyc_verification() from public;
grant execute on function public.request_kyc_verification() to authenticated;
```

- [ ] **Step 4: Apply the migration and verify the RPC test passes**

Run: `npx supabase db reset && npm run test:integration`
Expected: PASS (2 new tests)

- [ ] **Step 5: Write the failing webhook test**

Create `tests/integration/webhook-kyc.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser } from './helpers/create-verified-user'

const admin = createAdminClient()

function buildIdentityEvent(type: string, userId: string, eventId: string) {
  const body = JSON.stringify({
    id: eventId,
    type,
    data: { object: { id: 'vs_test_123', metadata: { user_id: userId } } },
  })
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  })
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  })
}

describe('Stripe Identity webhook handling', () => {
  it('marks a profile verified on identity.verification_session.verified', async () => {
    const user = await createVerifiedUser('kyc-webhook')
    const response = await POST(
      buildIdentityEvent('identity.verification_session.verified', user.userId, `evt_kyc_ok_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: profile } = await admin.from('profiles').select('kyc_status').eq('id', user.userId).single()
    expect(profile?.kyc_status).toBe('verified')
  })

  it('marks a profile rejected on identity.verification_session.requires_input', async () => {
    const user = await createVerifiedUser('kyc-webhook-fail')
    const response = await POST(
      buildIdentityEvent('identity.verification_session.requires_input', user.userId, `evt_kyc_fail_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: profile } = await admin.from('profiles').select('kyc_status').eq('id', user.userId).single()
    expect(profile?.kyc_status).toBe('rejected')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — profile stays `unverified` because the webhook route's `switch` doesn't yet handle identity events.

- [ ] **Step 7: Add the identity event handlers to the webhook route**

Modify `app/api/webhooks/stripe/route.ts` — replace the `switch` body and add handler functions:
```ts
    switch (event.type) {
      case 'identity.verification_session.verified':
        await handleIdentityVerified(admin, event)
        break
      case 'identity.verification_session.requires_input':
        await handleIdentityRequiresInput(admin, event)
        break
      default:
        break
    }
```

Add above the `POST` function:
```ts
async function handleIdentityVerified(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const session = event.data.object as Stripe.Identity.VerificationSession
  const userId = session.metadata?.user_id
  if (!userId) return
  await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', userId)
}

async function handleIdentityRequiresInput(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const session = event.data.object as Stripe.Identity.VerificationSession
  const userId = session.metadata?.user_id
  if (!userId) return
  await admin.from('profiles').update({ kyc_status: 'rejected' }).eq('id', userId)
}
```

- [ ] **Step 8: Run to verify the webhook tests pass**

Run: `npm run test:integration`
Expected: PASS (2 new tests)

- [ ] **Step 9: Add the server action and page that kick off verification**

Add `NEXT_PUBLIC_APP_URL=http://localhost:3000` to `.env.example` and your local `.env.local`.

Create `app/kyc/actions.ts`:
```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'

export async function startKycVerification(): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const session = await stripe.identity.verificationSessions.create({
    type: 'document',
    metadata: { user_id: user.id },
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
  })

  const { error } = await supabase.rpc('request_kyc_verification')
  if (error) return { error: error.message }

  return { url: session.url! }
}
```

Create `app/kyc/page.tsx`:
```tsx
'use client'

import { useState, useTransition } from 'react'
import { startKycVerification } from './actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function KycPage() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleStart() {
    setError(null)
    startTransition(async () => {
      const result = await startKycVerification()
      if ('error' in result) setError(result.error)
      else window.location.href = result.url
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Verify your identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Verifying your identity raises your withdrawal limit above $100 total. It takes about two minutes.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleStart} className="w-full" disabled={isPending}>
            {isPending ? 'Starting…' : 'Start verification'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

This action is exercised end-to-end (network call to Stripe included) manually and in staging rather than by an automated test here — Stripe Identity's hosted document-upload UI isn't practical to drive from Playwright. Task 16's e2e critical-path test verifies the withdrawal cap logic by setting `kyc_status` directly via the admin client, which is the part of this flow that actually matters for correctness.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add KYC verification via Stripe Identity"
```

---

## Task 12: Deposit flow

**Files:**
- Create: `app/deposit/actions.ts`
- Create: `app/deposit/page.tsx`
- Modify: `app/api/webhooks/stripe/route.ts` (add 1 case + 1 handler)
- Test: `tests/unit/deposit-actions.test.ts`
- Test: `tests/integration/webhook-deposit.test.ts`

**Interfaces:**
- Consumes: `depositSchema` (Task 7), `depositRateLimit`/`enforceRateLimit` (Task 7), `stripe` client (Task 10), `record_deposit` RPC (Task 6), webhook skeleton (Task 10).
- Produces: `createDepositIntent(amountCents: number): Promise<{ clientSecret: string } | { error: string }>` — the deposit page's confirmation form uses the returned `clientSecret` with Stripe Elements.

- [ ] **Step 1: Install the Stripe React bindings**

Run: `npm install @stripe/react-stripe-js`

- [ ] **Step 2: Write the failing unit test for the deposit action**

Create `tests/unit/deposit-actions.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/stripe/client', () => ({ stripe: { paymentIntents: { create: vi.fn() } } }))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(true) }
})

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { createDepositIntent } from '@/app/deposit/actions'

function mockSupabase(userId: string | null, accountId: string | null) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: accountId ? { id: accountId } : null }) }) }),
    }),
  }
}

describe('createDepositIntent', () => {
  it('rejects an amount below the schema minimum', async () => {
    ;(createClient as any).mockResolvedValue(mockSupabase('u1', 'a1'))
    const result = await createDepositIntent(50)
    expect(result).toHaveProperty('error')
  })

  it('creates a PaymentIntent and returns its client secret', async () => {
    ;(createClient as any).mockResolvedValue(mockSupabase('u1', 'a1'))
    ;(stripe.paymentIntents.create as any).mockResolvedValue({ client_secret: 'pi_secret_123' })

    const result = await createDepositIntent(2000)
    expect(result).toEqual({ clientSecret: 'pi_secret_123' })
    expect(stripe.paymentIntents.create).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `@/app/deposit/actions`.

- [ ] **Step 4: Implement the deposit action**

Create `app/deposit/actions.ts`:
```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { depositSchema } from '@/lib/validation/wallet'
import { depositRateLimit, enforceRateLimit } from '@/lib/rate-limit'

export async function createDepositIntent(
  amountCents: number
): Promise<{ clientSecret: string } | { error: string }> {
  const parsed = depositSchema.safeParse({ amountCents })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: account } = await supabase.from('accounts').select('id').eq('user_id', user.id).single()
  if (!account) return { error: 'Account not found' }

  const allowed = await enforceRateLimit(depositRateLimit, user.id)
  if (!allowed) return { error: 'Too many deposit attempts. Try again later.' }

  const idempotencyKey = `deposit-${account.id}-${Date.now()}`
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: parsed.data.amountCents,
      currency: 'usd',
      metadata: { account_id: account.id, idempotency_key: idempotencyKey },
    },
    { idempotencyKey }
  )

  return { clientSecret: paymentIntent.client_secret! }
}
```

Note the same `idempotencyKey` is used both as the Stripe API idempotency key (prevents duplicate PaymentIntents on client retry) and passed through `metadata` so the webhook handler can hand it to `record_deposit`'s `p_idempotency_key` — one key ties the Stripe-side and ledger-side idempotency together.

- [ ] **Step 5: Run to verify the unit tests pass**

Run: `npm run test:unit`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the deposit page**

Create `app/deposit/page.tsx`:
```tsx
'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { createDepositIntent } from './actions'
import { depositSchema } from '@/lib/validation/wallet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function DepositPage() {
  const [amount, setAmount] = useState('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleStart() {
    setError(null)
    const amountCents = Math.round(parseFloat(amount) * 100)
    const parsed = depositSchema.safeParse({ amountCents })
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    startTransition(async () => {
      const result = await createDepositIntent(amountCents)
      if ('error' in result) setError(result.error)
      else setClientSecret(result.clientSecret)
    })
  }

  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <DepositConfirmForm />
      </Elements>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Deposit money</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="number"
            placeholder="Amount in USD"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            step="0.01"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleStart} className="w-full" disabled={isPending}>
            {isPending ? 'Preparing…' : 'Continue'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function DepositConfirmForm() {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setIsSubmitting(true)
    setError(null)

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/dashboard` },
    })
    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed')
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-sm space-y-4 p-8">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={!stripe || isSubmitting}>
        {isSubmitting ? 'Processing…' : 'Confirm deposit'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 7: Write the failing webhook test**

Create `tests/integration/webhook-deposit.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser } from './helpers/create-verified-user'

const admin = createAdminClient()

function buildPaymentIntentEvent(accountId: string, amountCents: number, idempotencyKey: string, eventId: string) {
  const body = JSON.stringify({
    id: eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_test_${eventId}`,
        amount: amountCents,
        metadata: { account_id: accountId, idempotency_key: idempotencyKey },
      },
    },
  })
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  })
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  })
}

describe('deposit webhook handling', () => {
  it('credits the ledger when payment_intent.succeeded arrives', async () => {
    const user = await createVerifiedUser('depositor-webhook')
    const idempotencyKey = `deposit-${user.accountId}-${Date.now()}`

    const response = await POST(
      buildPaymentIntentEvent(user.accountId, 3000, idempotencyKey, `evt_deposit_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(3000)
  })
})
```

- [ ] **Step 8: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — ledger is not credited because the webhook route doesn't handle `payment_intent.succeeded` yet.

- [ ] **Step 9: Add the deposit handler to the webhook route**

Modify `app/api/webhooks/stripe/route.ts` — add a case:
```ts
      case 'payment_intent.succeeded':
        await handleDepositSucceeded(admin, event)
        break
```

Add a handler function above `POST`:
```ts
async function handleDepositSucceeded(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent
  const accountId = paymentIntent.metadata?.account_id
  const idempotencyKey = paymentIntent.metadata?.idempotency_key
  if (!accountId || !idempotencyKey) return

  await admin.rpc('record_deposit', {
    p_account_id: accountId,
    p_amount_cents: paymentIntent.amount,
    p_stripe_reference: paymentIntent.id,
    p_idempotency_key: idempotencyKey,
  })
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `npm run test:integration`
Expected: PASS (1 new test)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add deposit flow with Stripe Elements and webhook confirmation"
```

---

## Task 13: Withdrawal flow

**Known simplification (call this out, don't gloss over it):** `stripe.payouts.create` pays out from your Stripe *platform* balance to *your own* bank account — it does not pay an arbitrary end user directly. A production build needs Stripe Connect (an Express/Custom account per user, funded via `stripe.transfers.create`, then paid out from that connected account) plus a bank-account-linking UI. This task wires up the ledger/webhook/reversal plumbing correctly and keeps the Stripe call structurally in the right place, but the actual per-user payout destination is a fast-follow before real withdrawals go live — flag this explicitly in the PR/spec status, don't let it pass as production-ready.

**Files:**
- Create: `app/withdraw/actions.ts`
- Create: `app/withdraw/page.tsx`
- Modify: `app/api/webhooks/stripe/route.ts` (add 2 cases + 2 handlers)
- Test: `tests/unit/withdraw-actions.test.ts`
- Test: `tests/integration/webhook-withdrawal.test.ts`

**Interfaces:**
- Consumes: `withdrawalSchema` (Task 7), `withdrawalRateLimit`/`enforceRateLimit` (Task 7), `requireVerifiedMfa` (Task 9), `stripe` client (Task 10), `record_withdrawal`/`confirm_withdrawal`/`reverse_withdrawal` RPCs (Task 6), webhook skeleton (Task 10).
- Produces: `requestWithdrawal(amountCents: number): Promise<{ status: 'pending' } | { error: string }>`.

- [ ] **Step 1: Write the failing unit test for the withdrawal action**

Create `tests/unit/withdraw-actions.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/stripe/client', () => ({ stripe: { payouts: { create: vi.fn() } } }))
vi.mock('@/lib/auth/mfa', () => ({ requireVerifiedMfa: vi.fn() }))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(true) }
})

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { requestWithdrawal } from '@/app/withdraw/actions'

function mockSupabase(rpc: (fn: string, args: unknown) => Promise<any>) {
  return { rpc }
}

describe('requestWithdrawal', () => {
  it('returns an error when MFA is not verified', async () => {
    ;(requireVerifiedMfa as any).mockResolvedValue({ ok: false, error: 'Two-factor verification is required' })
    const result = await requestWithdrawal(2000)
    expect(result).toHaveProperty('error')
  })

  it('returns pending when the RPC and payout both succeed', async () => {
    ;(requireVerifiedMfa as any).mockResolvedValue({ ok: true, userId: 'u1' })
    ;(createClient as any).mockResolvedValue(
      mockSupabase(async () => ({ data: { transaction_id: 'txn-1', status: 'pending' }, error: null }))
    )
    ;(stripe.payouts.create as any).mockResolvedValue({ id: 'po_123' })

    expect(await requestWithdrawal(2000)).toEqual({ status: 'pending' })
  })

  it('reverses the ledger debit and returns an error if the payout call fails', async () => {
    ;(requireVerifiedMfa as any).mockResolvedValue({ ok: true, userId: 'u1' })
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'record_withdrawal') return { data: { transaction_id: 'txn-2', status: 'pending' }, error: null }
      if (fn === 'reverse_withdrawal') return { data: { status: 'reversed' }, error: null }
      return { data: null, error: null }
    })
    ;(createClient as any).mockResolvedValue(mockSupabase(rpc))
    ;(stripe.payouts.create as any).mockRejectedValue(new Error('card_declined'))

    const result = await requestWithdrawal(2000)
    expect(result).toHaveProperty('error')
    expect(rpc).toHaveBeenCalledWith('reverse_withdrawal', expect.objectContaining({ p_transaction_id: 'txn-2' }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `@/app/withdraw/actions`.

- [ ] **Step 3: Implement the withdrawal action**

Create `app/withdraw/actions.ts`:
```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { withdrawalSchema } from '@/lib/validation/wallet'
import { withdrawalRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { requireVerifiedMfa } from '@/lib/auth/mfa'

export async function requestWithdrawal(
  amountCents: number
): Promise<{ status: 'pending' } | { error: string }> {
  const parsed = withdrawalSchema.safeParse({ amountCents })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) return { error: mfa.error }

  const allowed = await enforceRateLimit(withdrawalRateLimit, mfa.userId)
  if (!allowed) return { error: 'Too many withdrawal attempts. Try again later.' }

  const supabase = await createClient()
  const idempotencyKey = `withdrawal-${mfa.userId}-${Date.now()}`

  const { data: result, error } = await supabase.rpc('record_withdrawal', {
    p_amount_cents: parsed.data.amountCents,
    p_idempotency_key: idempotencyKey,
  })
  if (error) return { error: error.message }

  try {
    await stripe.payouts.create(
      { amount: parsed.data.amountCents, currency: 'usd', metadata: { transaction_id: result.transaction_id } },
      { idempotencyKey }
    )
  } catch (payoutError) {
    // The ledger was already debited by record_withdrawal above; the RPC
    // grants authenticated users permission to reverse their own
    // still-pending withdrawal (see Task 6), so this runs in the user's
    // own session — no admin client involved.
    await supabase.rpc('reverse_withdrawal', {
      p_transaction_id: result.transaction_id,
      p_reason: payoutError instanceof Error ? payoutError.message : 'payout_creation_failed',
    })
    return { error: 'Withdrawal could not be initiated. Your balance has been restored.' }
  }

  return { status: 'pending' }
}
```

- [ ] **Step 4: Run to verify the unit tests pass**

Run: `npm run test:unit`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the withdraw page**

Create `app/withdraw/page.tsx`:
```tsx
'use client'

import { useState, useTransition } from 'react'
import { requestWithdrawal } from './actions'
import { withdrawalSchema } from '@/lib/validation/wallet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function WithdrawPage() {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    setError(null)
    const amountCents = Math.round(parseFloat(amount) * 100)
    const parsed = withdrawalSchema.safeParse({ amountCents })
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    startTransition(async () => {
      const result = await requestWithdrawal(amountCents)
      if ('error' in result) setError(result.error)
      else setSuccess(true)
    })
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-center text-muted-foreground">
          Your withdrawal is on its way. It typically arrives in 1-3 business days.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Withdraw money</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="number"
            placeholder="Amount in USD"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            step="0.01"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSubmit} className="w-full" disabled={isPending}>
            {isPending ? 'Processing…' : 'Withdraw'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Write the failing webhook test**

Create `tests/integration/webhook-withdrawal.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

const admin = createAdminClient()

function buildPayoutEvent(type: string, transactionId: string, eventId: string) {
  const body = JSON.stringify({
    id: eventId,
    type,
    data: { object: { id: `po_test_${eventId}`, metadata: { transaction_id: transactionId } } },
  })
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  })
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  })
}

describe('withdrawal webhook handling', () => {
  it('completes the transaction on payout.paid', async () => {
    const user = await createVerifiedUser('withdraw-webhook-ok')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)
    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const response = await POST(
      buildPayoutEvent('payout.paid', withdrawal.transaction_id, `evt_payout_ok_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: txn } = await admin
      .from('transactions')
      .select('status')
      .eq('id', withdrawal.transaction_id)
      .single()
    expect(txn?.status).toBe('completed')
  })

  it('reverses the ledger debit on payout.failed', async () => {
    const user = await createVerifiedUser('withdraw-webhook-fail')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)
    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const response = await POST(
      buildPayoutEvent('payout.failed', withdrawal.transaction_id, `evt_payout_fail_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(10000)
  })
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — the webhook route doesn't handle `payout.paid`/`payout.failed` yet.

- [ ] **Step 8: Add the payout handlers to the webhook route**

Modify `app/api/webhooks/stripe/route.ts` — add two cases:
```ts
      case 'payout.paid':
        await handlePayoutPaid(admin, event)
        break
      case 'payout.failed':
        await handlePayoutFailed(admin, event)
        break
```

Add two handler functions above `POST`:
```ts
async function handlePayoutPaid(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout
  const transactionId = payout.metadata?.transaction_id
  if (!transactionId) return
  await admin.rpc('confirm_withdrawal', { p_transaction_id: transactionId, p_stripe_reference: payout.id })
}

async function handlePayoutFailed(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout
  const transactionId = payout.metadata?.transaction_id
  if (!transactionId) return
  await admin.rpc('reverse_withdrawal', { p_transaction_id: transactionId, p_reason: 'stripe_payout_failed' })
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm run test:integration`
Expected: PASS (2 new tests)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add withdrawal flow with payout webhook confirmation and reversal"
```

---

## Task 14: P2P transfer flow

**Files:**
- Create: `supabase/migrations/<timestamp>_find_recipient_account_rpc.sql`
- Create: `app/send/actions.ts`
- Create: `app/send/page.tsx`
- Test: `tests/integration/rpc-find-recipient.test.ts`
- Test: `tests/unit/send-money-actions.test.ts`

**Interfaces:**
- Consumes: `transferSchema` (Task 7), `transferRateLimit`/`enforceRateLimit` (Task 7), `requireVerifiedMfa` (Task 9), `transfer_funds` RPC (Task 5), `email` field on `createVerifiedUser`'s return (Task 5).
- Produces: RPC `find_recipient_account(p_email text): uuid | null` (authenticated only — resolves a Valoron user's account id from their email without exposing any other profile data). `sendMoney(recipientEmail: string, amountCents: number): Promise<{ status: 'completed' } | { error: string }>`.

- [ ] **Step 1: Write the failing RPC test**

Create `tests/integration/rpc-find-recipient.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createVerifiedUser } from './helpers/create-verified-user'

describe('find_recipient_account RPC', () => {
  it('returns the account id for a registered email', async () => {
    const recipient = await createVerifiedUser('lookup-target')
    const sender = await createVerifiedUser('lookup-sender')

    const { data, error } = await sender.client.rpc('find_recipient_account', { p_email: recipient.email })
    expect(error).toBeNull()
    expect(data).toBe(recipient.accountId)
  })

  it('returns null for an email with no account', async () => {
    const sender = await createVerifiedUser('lookup-sender-2')
    const { data, error } = await sender.client.rpc('find_recipient_account', {
      p_email: 'nobody-here@example.com',
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('rejects an unauthenticated caller', async () => {
    const anon = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { error } = await anon.rpc('find_recipient_account', { p_email: 'anyone@example.com' })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `could not find function public.find_recipient_account`.

- [ ] **Step 3: Write the migration**

Run: `npx supabase migration new find_recipient_account_rpc`, then fill it in:
```sql
create or replace function public.find_recipient_account(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select a.id into v_account_id
  from auth.users u
  join public.accounts a on a.user_id = u.id
  where lower(u.email) = lower(p_email);

  return v_account_id;
end;
$$;

revoke execute on function public.find_recipient_account(text) from public;
grant execute on function public.find_recipient_account(text) to authenticated;
```

- [ ] **Step 4: Apply and verify the RPC test passes**

Run: `npx supabase db reset && npm run test:integration`
Expected: PASS (3 new tests)

- [ ] **Step 5: Write the failing unit test for the send-money action**

Create `tests/unit/send-money-actions.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/mfa', () => ({ requireVerifiedMfa: vi.fn() }))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(true) }
})

import { createClient } from '@/lib/supabase/server'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { sendMoney } from '@/app/send/actions'

function mockSupabase(rpc: (fn: string, args: unknown) => Promise<any>) {
  return { rpc }
}

describe('sendMoney', () => {
  it('returns an error when MFA is not verified', async () => {
    ;(requireVerifiedMfa as any).mockResolvedValue({ ok: false, error: 'Two-factor verification is required' })
    expect(await sendMoney('a@b.com', 1000)).toHaveProperty('error')
  })

  it('returns an error when the recipient is not found', async () => {
    ;(requireVerifiedMfa as any).mockResolvedValue({ ok: true, userId: 'u1' })
    ;(createClient as any).mockResolvedValue(mockSupabase(async () => ({ data: null, error: null })))
    expect(await sendMoney('nobody@example.com', 1000)).toHaveProperty('error')
  })

  it('completes the transfer when the recipient exists and the RPC succeeds', async () => {
    ;(requireVerifiedMfa as any).mockResolvedValue({ ok: true, userId: 'u1' })
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'find_recipient_account') return { data: 'acct-2', error: null }
      if (fn === 'transfer_funds') return { data: { transaction_id: 'txn-1', status: 'completed' }, error: null }
      return { data: null, error: null }
    })
    ;(createClient as any).mockResolvedValue(mockSupabase(rpc))

    expect(await sendMoney('friend@example.com', 1000)).toEqual({ status: 'completed' })
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `@/app/send/actions`.

- [ ] **Step 7: Implement the send-money action**

Create `app/send/actions.ts`:
```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { transferSchema } from '@/lib/validation/wallet'
import { transferRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { requireVerifiedMfa } from '@/lib/auth/mfa'

export async function sendMoney(
  recipientEmail: string,
  amountCents: number
): Promise<{ status: 'completed' } | { error: string }> {
  const parsed = transferSchema.safeParse({ recipientEmail, amountCents })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) return { error: mfa.error }

  const allowed = await enforceRateLimit(transferRateLimit, mfa.userId)
  if (!allowed) return { error: 'Too many transfer attempts. Try again in a minute.' }

  const supabase = await createClient()

  const { data: recipientAccountId, error: lookupError } = await supabase.rpc('find_recipient_account', {
    p_email: parsed.data.recipientEmail,
  })
  if (lookupError) return { error: lookupError.message }
  if (!recipientAccountId) return { error: 'No Valoron user found with that email' }

  const idempotencyKey = `transfer-${mfa.userId}-${Date.now()}`
  const { error } = await supabase.rpc('transfer_funds', {
    p_recipient_account_id: recipientAccountId,
    p_amount_cents: parsed.data.amountCents,
    p_idempotency_key: idempotencyKey,
  })
  if (error) return { error: error.message }

  return { status: 'completed' }
}
```

- [ ] **Step 8: Run to verify the unit tests pass**

Run: `npm run test:unit`
Expected: PASS (3 tests)

- [ ] **Step 9: Write the send-money page — with optimistic UI and toast errors**

Per the design spec's UX section, transfers get optimistic UI with rollback on failure (not just a pending spinner), and errors surface as toasts (mounted globally in Task 1) rather than inline text:

Create `app/send/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { sendMoney } from './actions'
import { transferSchema } from '@/lib/validation/wallet'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SendMoneyPage() {
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [sentOptimistically, setSentOptimistically] = useState(false)

  async function handleSubmit() {
    const amountCents = Math.round(parseFloat(amount) * 100)
    const parsed = transferSchema.safeParse({ recipientEmail: email, amountCents })
    if (!parsed.success) {
      toast({ variant: 'destructive', title: 'Could not send', description: parsed.error.issues[0].message })
      return
    }

    // Optimistic: show the confirmation immediately instead of waiting on
    // the round trip. If the server rejects it, roll back to the form and
    // surface exactly why via a toast.
    setSentOptimistically(true)
    const result = await sendMoney(email, amountCents)
    if ('error' in result) {
      setSentOptimistically(false)
      toast({ variant: 'destructive', title: 'Transfer failed', description: result.error })
    }
  }

  if (sentOptimistically) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-muted-foreground">Sent!</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Send money</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="email"
            placeholder="Recipient's email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Amount in USD"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
          />
          <Button onClick={handleSubmit} className="w-full">
            Send
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

Note for Task 16's e2e test: because "Sent!" now renders optimistically (before the server responds), it's no longer proof by itself that the transfer succeeded — the recipient's balance assertion later in that same test is what actually verifies success. This is the expected, correct trade-off of optimistic UI, not a testing gap.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add P2P transfer flow with email-based recipient lookup"
```

---

## Task 15: Dashboard, transaction detail, and settings pages

**Files:**
- Create: `lib/format.ts`
- Create: `components/wallet/balance-card.tsx`
- Create: `components/wallet/transaction-list.tsx`
- Create: `components/wallet/dashboard-client.tsx`
- Create: `supabase/migrations/<timestamp>_enable_realtime_ledger.sql`
- Modify: `app/dashboard/page.tsx` (replace Task 8's placeholder)
- Create: `app/dashboard/loading.tsx`
- Create: `app/transactions/[id]/page.tsx`
- Create: `app/settings/page.tsx`
- Test: `tests/unit/format.test.ts`
- Test: `tests/unit/transaction-list.test.tsx`
- Test: `tests/unit/balance-card.test.tsx`

**Interfaces:**
- Consumes: `createClient` server client (Task 2), `createClient` browser client (Task 2), `formatCents` used by both presentational components below.
- Produces: `formatCents(cents: number): string`. `TransactionRow` type and `TransactionList` component. `BalanceCard` component. These three are shared by the dashboard, transaction detail, and (implicitly) any future page that lists money movements.

The Server Components and the Realtime subscription wiring in this task are exercised by Task 16's e2e critical-path test rather than by component-level tests here — Next.js Server Components with live Supabase calls and a Realtime channel's subscribe/unsubscribe lifecycle aren't meaningfully testable in isolation. What *is* unit-tested here is the pure formatting and presentational logic, which is where a display bug (e.g. a sign error on debit/credit) would actually originate.

- [ ] **Step 1: Write the failing test for currency formatting**

Create `tests/unit/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatCents } from '@/lib/format'

describe('formatCents', () => {
  it('formats a whole-dollar amount with thousands separators', () => {
    expect(formatCents(500000)).toBe('$5,000.00')
  })
  it('formats cents correctly', () => {
    expect(formatCents(1099)).toBe('$10.99')
  })
  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00')
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:unit` — expect FAIL (module not found).

Create `lib/format.ts`:
```ts
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
```

Run: `npm run test:unit` — expect PASS (3 tests).

- [ ] **Step 3: Write the failing test for the transaction list component**

Create `tests/unit/transaction-list.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransactionList } from '@/components/wallet/transaction-list'

describe('TransactionList', () => {
  it('shows an empty state with no transactions', () => {
    render(<TransactionList transactions={[]} />)
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
  })

  it('renders a credit with a plus sign and a debit with a minus sign', () => {
    render(
      <TransactionList
        transactions={[
          {
            id: 't1',
            type: 'deposit',
            status: 'completed',
            amountCents: 2000,
            direction: 'credit',
            createdAt: new Date().toISOString(),
          },
          {
            id: 't2',
            type: 'withdrawal',
            status: 'pending',
            amountCents: 500,
            direction: 'debit',
            createdAt: new Date().toISOString(),
          },
        ]}
      />
    )
    expect(screen.getByText('+$20.00')).toBeInTheDocument()
    expect(screen.getByText('-$5.00')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to verify it fails, then implement**

Run: `npm run test:unit` — expect FAIL (module not found).

Create `components/wallet/transaction-list.tsx`:
```tsx
import Link from 'next/link'
import { formatCents } from '@/lib/format'
import { Badge } from '@/components/ui/badge'

export type TransactionRow = {
  id: string
  type: 'p2p_transfer' | 'deposit' | 'withdrawal'
  status: 'pending' | 'completed' | 'failed' | 'reversed'
  amountCents: number
  direction: 'credit' | 'debit'
  createdAt: string
}

export function TransactionList({ transactions }: { transactions: TransactionRow[] }) {
  if (transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions yet.</p>
  }
  return (
    <ul className="divide-y">
      {transactions.map((txn) => (
        <li key={txn.id}>
          <Link href={`/transactions/${txn.id}`} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium capitalize">{txn.type.replace('_', ' ')}</p>
              <p className="text-xs text-muted-foreground">{new Date(txn.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={txn.direction === 'credit' ? 'text-green-600' : 'text-foreground'}>
                {txn.direction === 'credit' ? '+' : '-'}
                {formatCents(txn.amountCents)}
              </span>
              <Badge variant={txn.status === 'completed' ? 'default' : 'secondary'}>{txn.status}</Badge>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

Run: `npm run test:unit` — expect PASS (2 new tests).

- [ ] **Step 5: Write the failing test for the balance card, then implement**

Create `tests/unit/balance-card.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BalanceCard } from '@/components/wallet/balance-card'

describe('BalanceCard', () => {
  it('displays the formatted balance', () => {
    render(<BalanceCard balanceCents={123456} />)
    expect(screen.getByTestId('balance-amount')).toHaveTextContent('$1,234.56')
  })
})
```

Run: `npm run test:unit` — expect FAIL (module not found).

Create `components/wallet/balance-card.tsx`:
```tsx
import Link from 'next/link'
import { formatCents } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function BalanceCard({ balanceCents }: { balanceCents: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Balance</CardTitle>
      </CardHeader>
      <CardContent>
        <p data-testid="balance-amount" className="text-4xl font-semibold tracking-tight">
          {formatCents(balanceCents)}
        </p>
        <div className="mt-4 flex gap-2">
          <Button asChild size="sm">
            <Link href="/send">Send</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/deposit">Deposit</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/withdraw">Withdraw</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

Run: `npm run test:unit` — expect PASS (1 new test).

- [ ] **Step 6: Enable Realtime on `ledger_entries`**

Run: `npx supabase migration new enable_realtime_ledger`, then fill it in:
```sql
alter publication supabase_realtime add table public.ledger_entries;
```
Run: `npx supabase db reset`.

- [ ] **Step 7: Build the dashboard's Realtime client component and Server Component**

Create `components/wallet/dashboard-client.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BalanceCard } from '@/components/wallet/balance-card'
import { TransactionList, type TransactionRow } from '@/components/wallet/transaction-list'

export function DashboardClient({
  accountId,
  initialBalanceCents,
  initialTransactions,
}: {
  accountId: string
  initialBalanceCents: number
  initialTransactions: TransactionRow[]
}) {
  const [balanceCents, setBalanceCents] = useState(initialBalanceCents)
  const [transactions, setTransactions] = useState(initialTransactions)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`account-${accountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ledger_entries', filter: `account_id=eq.${accountId}` },
        (payload) => {
          const row = payload.new as { balance_after_cents: number }
          setBalanceCents(row.balance_after_cents)
          // Refetching the list on each event keeps this simple and
          // correct at this MVP's scale; the Scaling spec revisits
          // whether that still holds at 10k-20k concurrent users.
          supabase
            .from('transactions')
            .select('id, type, status, created_at, ledger_entries!inner(amount_cents, direction, account_id)')
            .eq('ledger_entries.account_id', accountId)
            .order('created_at', { ascending: false })
            .limit(20)
            .then(({ data }) => {
              if (!data) return
              setTransactions(
                data.map((t: any) => ({
                  id: t.id,
                  type: t.type,
                  status: t.status,
                  createdAt: t.created_at,
                  amountCents: t.ledger_entries[0].amount_cents,
                  direction: t.ledger_entries[0].direction,
                }))
              )
            })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId])

  return (
    <div className="space-y-6 p-8">
      <BalanceCard balanceCents={balanceCents} />
      <div>
        <h2 className="mb-2 text-lg font-medium">Recent activity</h2>
        <TransactionList transactions={transactions} />
      </div>
    </div>
  )
}
```

Replace `app/dashboard/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/wallet/dashboard-client'
import type { TransactionRow } from '@/components/wallet/transaction-list'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: account } = await supabase.from('accounts').select('id').eq('user_id', user.id).single()
  if (!account) redirect('/login')

  const { data: latestEntry } = await supabase
    .from('ledger_entries')
    .select('balance_after_cents')
    .eq('account_id', account.id)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: txnRows } = await supabase
    .from('transactions')
    .select('id, type, status, created_at, ledger_entries!inner(amount_cents, direction, account_id)')
    .eq('ledger_entries.account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const transactions: TransactionRow[] = (txnRows ?? []).map((t: any) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    createdAt: t.created_at,
    amountCents: t.ledger_entries[0].amount_cents,
    direction: t.ledger_entries[0].direction,
  }))

  return (
    <DashboardClient
      accountId={account.id}
      initialBalanceCents={latestEntry?.balance_after_cents ?? 0}
      initialTransactions={transactions}
    />
  )
}
```

Create `app/dashboard/loading.tsx` — Next.js renders this automatically while the Server Component above is fetching, satisfying the design spec's "skeleton loading states" requirement:
```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-8">
      <div className="space-y-3 rounded-lg border p-6">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-10 w-40" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Build the transaction detail page**

Create `app/transactions/[id]/page.tsx`:
```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatCents } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: transaction } = await supabase
    .from('transactions')
    .select('id, type, status, created_at, ledger_entries(amount_cents, direction, account_id)')
    .eq('id', id)
    .maybeSingle()
  if (!transaction) notFound()

  const { data: account } = await supabase.from('accounts').select('id').eq('user_id', user.id).single()
  const myEntry = (transaction.ledger_entries as any[]).find((e) => e.account_id === account?.id)
  if (!myEntry) notFound() // RLS already hides other users' transactions; this is a defensive double-check

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="capitalize">{transaction.type.replace('_', ' ')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-3xl font-semibold">
            {myEntry.direction === 'credit' ? '+' : '-'}
            {formatCents(myEntry.amount_cents)}
          </p>
          <Badge variant={transaction.status === 'completed' ? 'default' : 'secondary'}>{transaction.status}</Badge>
          <p className="text-sm text-muted-foreground">{new Date(transaction.created_at).toLocaleString()}</p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 9: Build the settings page**

Create `app/settings/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, kyc_status')
    .eq('id', user.id)
    .single()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const mfaEnabled = factors?.totp.some((f) => f.status === 'verified') ?? false

  return (
    <div className="mx-auto max-w-lg space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>{profile?.full_name}</p>
          <p className="text-muted-foreground">{user.email}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant={mfaEnabled ? 'default' : 'secondary'}>{mfaEnabled ? 'Enabled' : 'Not set up'}</Badge>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Identity verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant={profile?.kyc_status === 'verified' ? 'default' : 'secondary'}>
            {profile?.kyc_status}
          </Badge>
          {profile?.kyc_status !== 'verified' && (
            <Button asChild size="sm">
              <Link href="/kyc">Verify identity</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add dashboard, transaction detail, and settings pages with Realtime balance updates"
```

---

## Task 16: End-to-end critical path test and CI

**Files:**
- Create: `tests/e2e/critical-path.spec.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: every page and RPC built in Tasks 8-15.

**Scoping notes, stated plainly rather than glossed over:**
- The critical-path e2e test funds the sender's account via `admin.rpc('record_deposit', ...)` instead of driving Stripe's real Elements card-entry iframe. The Stripe side of a deposit (`payment_intent.succeeded` → `record_deposit`) is already covered by Task 12's webhook integration test; re-driving a live Stripe test-mode card payment here would add CI flakiness for no additional coverage.
- The test does **not** exercise a live withdrawal payout. Task 13's unit tests already cover both the success path and the reversal-on-payout-failure path with a mocked Stripe client, and Task 13's integration tests cover the `payout.paid`/`payout.failed` webhook branches directly. Driving a real Stripe test-mode payout end-to-end depends on the platform Stripe account's simulated available balance, which is an extra piece of CI environment setup for coverage that's already there.
- Because of these two scoping choices, **the full test suite (unit + integration + e2e) never makes a real network call to the Stripe API** — `STRIPE_SECRET_KEY` only needs to be a well-formed-looking string for `constructEvent`/`generateTestHeaderString` (both are local HMAC operations, not network calls). Use your real Stripe **test-mode** keys in actual local dev/staging so the deposit/KYC/withdrawal pages work when you click through them by hand — just know CI itself doesn't require them to be valid.
- Because `enforceRateLimit` (Task 7) now fails open, CI also doesn't require a real Upstash Redis — the dummy values already in `.env.local` are enough for the app to run correctly in CI.

- [ ] **Step 1: Write the critical-path e2e test**

Create `tests/e2e/critical-path.spec.ts`:
```ts
// Requires the local Supabase stack running: `npx supabase start`
import { test, expect, type Page } from '@playwright/test'
import { TOTP } from 'otpauth'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const admin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function signUpAndEnrollMfa(page: Page, email: string) {
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Critical Path User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('Str0ngPassword!')
  await page.getByRole('button', { name: /sign up/i }).click()
  await expect(page).toHaveURL(/\/mfa/)

  const secret = (await page.getByTestId('mfa-manual-key').textContent())!.trim()
  const totp = new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' })
  await page.getByPlaceholder('6-digit code').fill(totp.generate())
  await page.getByRole('button', { name: /verify and continue/i }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('signup, fund, and send money end to end through the real UI', async ({ page, browser }) => {
  const senderEmail = `critical-sender-${Date.now()}@example.com`
  const recipientEmail = `critical-recipient-${Date.now()}@example.com`

  // Recipient signs up in a separate browser context so they exist for
  // the sender to look up by email, and stays open to check their
  // balance after the transfer.
  const recipientContext = await browser.newContext()
  const recipientPage = await recipientContext.newPage()
  await signUpAndEnrollMfa(recipientPage, recipientEmail)

  await signUpAndEnrollMfa(page, senderEmail)

  // Fund the sender directly (see Scoping notes above for why).
  const { data: usersData } = await admin.auth.admin.listUsers()
  const senderUser = usersData.users.find((u) => u.email === senderEmail)!
  const { data: senderAccount } = await admin.from('accounts').select('id').eq('user_id', senderUser.id).single()
  await admin.rpc('record_deposit', {
    p_account_id: senderAccount!.id,
    p_amount_cents: 10000,
    p_stripe_reference: 'pi_test_critical_path',
    p_idempotency_key: `critical-path-fund-${Date.now()}`,
  })

  await page.goto('/dashboard')
  await expect(page.getByTestId('balance-amount')).toHaveText('$100.00')

  await page.goto('/send')
  await page.getByPlaceholder("Recipient's email").fill(recipientEmail)
  await page.getByPlaceholder('Amount in USD').fill('25')
  await page.getByRole('button', { name: /^send$/i }).click()
  await expect(page.getByText('Sent!')).toBeVisible()

  await page.goto('/dashboard')
  await expect(page.getByTestId('balance-amount')).toHaveText('$75.00')

  await recipientPage.goto('/dashboard')
  await expect(recipientPage.getByTestId('balance-amount')).toHaveText('$25.00')

  await recipientContext.close()
})
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm run test:e2e`
Expected: PASS (1 new test) — this exercises real signup, real MFA enrollment, and a real P2P transfer through the actual UI for two separate users.

- [ ] **Step 3: Write the CI workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      # These are Supabase's fixed, publicly documented local-dev demo
      # JWTs — the same `supabase start` prints for every local install,
      # safe to commit since they only work against 127.0.0.1. Copy the
      # exact values from your own `supabase start` output once.
      NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
      NEXT_PUBLIC_SUPABASE_ANON_KEY: <paste from `supabase start` output>
      SUPABASE_SERVICE_ROLE_KEY: <paste from `supabase start` output>
      # No real Stripe account needed in CI — see Scoping notes above.
      STRIPE_SECRET_KEY: sk_test_ci_placeholder
      STRIPE_WEBHOOK_SECRET: whsec_ci_placeholder
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk_test_ci_placeholder
      # No real Upstash account needed in CI either — enforceRateLimit
      # fails open when Redis is unreachable (Task 7).
      UPSTASH_REDIS_REST_URL: https://example-ci.upstash.io
      UPSTASH_REDIS_REST_TOKEN: ci-placeholder-token
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      NEXT_PUBLIC_SENTRY_DSN: ''
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Start local Supabase stack (applies all migrations)
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
          } >> .env.local

      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:integration

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - run: npm run test:e2e

      - run: npm run build
```

- [ ] **Step 4: Push and confirm the workflow runs green on GitHub**

Push the branch and open a PR (or push to `main` if that's the agreed workflow); confirm every step above shows green in the Actions tab before merging. This is the gate: per this plan's Global Constraints, merges require passing CI.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: add end-to-end critical path test and CI workflow"
```

---

## Post-implementation

This plan builds the Valoron Wallet core MVP end to end. Once all 16 tasks are complete and CI is green, the two follow-up specs from the design doc (`docs/superpowers/specs/2026-08-09-valoron-wallet-core-mvp-design.md`, §11) are ready to be brainstormed and planned the same way this one was:

1. **Security Hardening spec** — WAF/CDN edge rules, fraud/anomaly detection, secrets rotation, pen-test plan, incident response runbook.
2. **Scaling spec** — connection pooling, caching, queueing, autoscaling, and load testing to validate 10k baseline / 20k burst concurrent users.

**Before deploying anywhere real users can reach it**, per the design spec's §9 (this is deployment/ops setup, not a code task, so it's called out here rather than as one of the 16 tasks above):
- Create **separate Supabase projects** for staging and production (not just separate branches of one project) — this task's local-dev workflow (`supabase start`, migrations applied via `supabase db reset`) needs to be pushed to each with `supabase db push` or the CLI's migration-deploy flow.
- Use **separate Stripe key sets** for staging (test mode) and production (live mode) — never point a staging deploy at live Stripe keys.
- Point Vercel's preview/staging deployment at the staging Supabase project + Stripe test keys, and production at the production Supabase project + Stripe live keys, via Vercel's per-environment env vars.
- Re-enable Supabase email confirmation in both the staging and production Supabase project's Auth settings — Task 8 only disabled it in `supabase/config.toml` for **local** development.
