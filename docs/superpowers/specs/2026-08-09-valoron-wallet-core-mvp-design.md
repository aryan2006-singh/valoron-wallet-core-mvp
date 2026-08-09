# Valoron Wallet — Core MVP Design

**Status:** Approved for planning
**Date:** 2026-08-09
**Author:** Claude (with rsingharyan10@gmail.com)

## 1. Context and scope

Valoron is a new fiat "ledger" wallet product (like a Venmo/PayPal-style
wallet — internal balances, no blockchain/private keys). This is a
greenfield build; nothing exists yet.

The full ask (security against breach, resilience against traffic bursts
from ~10k to 20k concurrent users, and the product itself) is too large
for one spec, so it is split into three:

1. **This spec** — the core wallet MVP, built with security fundamentals
   in from day one.
2. **Security Hardening spec** (follow-up) — breach defense: WAF,
   fraud/anomaly detection, penetration-test readiness, incident response.
3. **Scaling spec** (follow-up) — burst/load handling for 10k→20k
   concurrent users: autoscaling, caching, queueing, DB pool tuning, load
   testing.

Real money moves through this product via a payment processor (Stripe).
**Note on scope boundary:** operating a live money-transmission product
typically requires either a money-transmitter license or a
banking/BaaS partner (e.g. Stripe Treasury/Issuing, Unit, Column) that
holds one. That is a legal/business step outside this spec's scope — this
document only covers the software architecture, built so it's ready for
that step.

## 2. Goals / non-goals

**Goals for this MVP:**
- Users can sign up, verify identity (KYC), and log in with mandatory MFA.
- Users can deposit real money (card/bank via Stripe), hold a USD balance,
  send money to other Valoron users, and withdraw back out.
- The ledger is correct and auditable under concurrent access.
- Security fundamentals (RLS, least-privilege, secrets handling, audit
  logging, basic rate limiting) are built in, not deferred.
- Frontend and backend are built to a professional, production-grade
  standard (typed contracts, tests in CI, structured logging), and the UI
  is a polished, clean-minimal fintech dashboard.

**Non-goals for this MVP (explicitly deferred):**
- Advanced breach defense (WAF, fraud/anomaly detection, pen-testing,
  incident response runbook) — Security Hardening spec.
- Handling 10k→20k concurrent burst traffic (autoscaling, caching layer,
  queueing, DB connection pool tuning, load testing) — Scaling spec.
- Multi-currency support, savings/interest, cards/Issuing, a custom admin
  dashboard (Supabase Studio is the admin tool for this phase).
- Obtaining a money-transmitter license or BaaS partnership (legal/business,
  not engineering).

## 3. Architecture

- **Frontend + server:** Next.js (App Router) on Vercel. UI, Server
  Actions/API routes, and the Stripe webhook handler all live here.
- **Data + auth:** Supabase Postgres (ledger + app data) and Supabase Auth
  (email/password, mandatory TOTP MFA before first transaction).
- **Payments:** Stripe — Payment Intents (deposits), Payouts (withdrawals),
  Stripe Identity (KYC), all reconciled via signed, deduped webhooks.
- **Rate limiting:** Upstash Redis (serverless, edge-friendly), guarding
  login, transfer, and withdrawal endpoints from day one. This is baseline
  abuse resistance, not the full burst/DDoS story (Scaling spec).
- **Observability:** Sentry for error tracking; structured logs (pino) in
  server and webhook code. Deep APM/enterprise observability is deferred
  to the Scaling spec.

## 4. Data model (Supabase Postgres)

All tables have Row Level Security **enabled with default-deny**. Only
`SECURITY DEFINER` RPC functions (section 5) may write to financial
tables; client roles get no direct INSERT/UPDATE/DELETE grants on them.

- **`profiles`**
  `id uuid PK references auth.users`, `full_name text`,
  `kyc_status text check in ('unverified','pending','verified','rejected') default 'unverified'`,
  `created_at timestamptz default now()`

- **`accounts`**
  `id uuid PK default gen_random_uuid()`, `user_id uuid references profiles not null unique`,
  `currency text default 'USD'`, `created_at timestamptz default now()`
  — one account per user for this MVP.

- **`ledger_entries`** (append-only; no UPDATE/DELETE grants for any role
  except a locked-down migration role)
  `id bigint PK generated always as identity`, `account_id uuid references accounts not null`,
  `transaction_id uuid references transactions not null`,
  `amount_cents bigint not null check (amount_cents > 0)`,
  `direction text check in ('credit','debit')`,
  `balance_after_cents bigint not null`, `created_at timestamptz default now()`

- **`transactions`**
  `id uuid PK default gen_random_uuid()`,
  `type text check in ('p2p_transfer','deposit','withdrawal')`,
  `status text check in ('pending','completed','failed','reversed') default 'pending'`,
  `initiated_by uuid references profiles`, `stripe_reference text`,
  `idempotency_key text unique not null`, `created_at timestamptz default now()`,
  `updated_at timestamptz default now()`
  — a transfer produces 2 ledger_entries (debit sender, credit receiver);
  a deposit/withdrawal produces 1, offset against the Stripe side.

- **`audit_log`** (append-only, populated by triggers on financial tables
  and by auth event hooks)
  `id bigint PK generated always as identity`, `actor_id uuid`,
  `action text not null`, `target_table text`, `target_id text`,
  `ip_address inet`, `user_agent text`, `metadata jsonb`,
  `created_at timestamptz default now()`

- **`webhook_events`** (Stripe webhook dedup)
  `id text PK` (Stripe event id), `type text`, `payload jsonb`,
  `processed_at timestamptz default now()`

Balance is **derived**, not a raw mutable column: either
`SUM(amount_cents * sign(direction))` over `ledger_entries` for an
account, or read from the latest entry's `balance_after_cents`
(materialized at write time by the RPC function for fast reads). This
prevents balance drift and keeps the ledger self-auditing.

## 5. Money-movement layer (the core security decision)

**All balance changes go through exactly three Postgres `SECURITY
DEFINER` RPC functions.** No other code path — not the Next.js server,
not the client — may write to `ledger_entries` or `transactions`
directly. This was chosen over app-layer transactions (the alternative
considered) because Postgres row locking gives strong concurrency-safety
guarantees "for free" and keeps the privileged write path narrow and
auditable, which matters most for a money product.

- **`transfer_funds(sender_account_id, recipient_account_id, amount_cents, idempotency_key)`**
  Runs in the *calling user's* auth context (not service role). Verifies
  `sender_account_id` belongs to `auth.uid()`, verifies MFA has been
  completed, row-locks both accounts (`SELECT ... FOR UPDATE`), checks
  sufficient balance, writes both ledger entries and the transaction row
  in one atomic transaction. Idempotency key makes retries safe.

- **`record_deposit(account_id, amount_cents, stripe_reference, idempotency_key)`**
  Called only by the Stripe webhook handler (service-role context) after
  a verified `payment_intent.succeeded` event. Credits the ledger.

- **`record_withdrawal(account_id, amount_cents, stripe_reference, idempotency_key)`**
  Requires `profiles.kyc_status = 'verified'` OR amount keeps the user's
  trailing withdrawal total under the pre-KYC cap (see §7). Debits the
  ledger as `pending`, later confirmed or reversed by webhook.

## 6. Money flows

1. **Deposit:** UI → server creates a Stripe PaymentIntent → client
   confirms via Stripe Elements → Stripe sends `payment_intent.succeeded`
   webhook → handler verifies signature, dedupes via `webhook_events`,
   calls `record_deposit` → ledger credited.

2. **P2P transfer:** sender picks a recipient (by handle/email) and an
   amount → server action calls `transfer_funds` in the sender's own auth
   context → RLS plus the RPC's internal checks guarantee only the
   authenticated sender's account can be debited.

3. **Withdrawal:** requires KYC (or is under the pre-KYC cap) → server
   creates a Stripe Payout → `record_withdrawal` debits the ledger as
   pending → webhook confirms completion, or on failure a **reversal
   ledger entry** is written (never mutate/delete the original entry).

## 7. Security-by-design baseline

- RLS enabled everywhere, default-deny. Users can read only their own
  `profiles` / `accounts` / `ledger_entries` / `transactions` rows.
- The three RPC functions above are the only write path for money —
  enforced at the database grant level, not just application logic.
- MFA (TOTP) is required before a user's first transaction, enforced
  **server-side** inside the RPC functions (checking a verified-MFA claim),
  not just gated in the UI — so it can't be bypassed by calling the API
  directly.
- Stripe webhook signatures are verified on every request; events are
  deduped via `webhook_events` before processing.
- The Supabase **service-role key is used in exactly one place**: the
  Stripe webhook handler. Nowhere else in the app touches it — this
  minimizes blast radius if any other server code path is compromised.
- Basic rate limiting (Upstash Redis) from day one on login, transfer, and
  withdrawal endpoints — baseline brute-force/abuse resistance. (Full
  DDoS/burst resilience is the Scaling spec.)
- Every financial mutation and auth event is written to the append-only
  `audit_log` (actor, action, target, IP, user agent, timestamp).
- Secrets (Stripe keys, Supabase service-role key) live only in Vercel's
  encrypted environment variables — never shipped to the client bundle.
- **Pre-KYC cap:** users may deposit and send/receive up to **$100
  cumulative** before KYC verification is required; withdrawals above
  that, or at all once the cap is hit, require `kyc_status = 'verified'`
  via Stripe Identity.

## 8. Frontend / UX

Next.js (App Router) + Tailwind + shadcn/ui. Visual direction: clean,
minimal fintech (Stripe/Mercury-style) — generous whitespace, restrained
color, strong typography, subtle motion; reads as trustworthy and
premium rather than playful.

Pages: sign up / login (+ MFA enrollment), dashboard (balance card,
recent transaction feed, quick actions), send money, deposit, withdraw,
transaction detail, settings (MFA management, KYC status).

UX details: skeleton loading states, optimistic UI for transfers with
rollback on failure, empty states, toast notifications for errors, and
live balance/transaction updates via Supabase Realtime.

## 9. Engineering discipline

- TypeScript end-to-end; Zod validation on every input, both client and
  server side.
- Vitest (unit) + Playwright (e2e) tests; GitHub Actions CI runs tests,
  typecheck, and lint on every PR — merges are gated on passing CI.
- Database schema changes are version-controlled SQL migration files
  (via Supabase CLI), never manual dashboard edits.
- Separate Supabase projects for staging and production, and separate
  Stripe test/live key sets.

## 10. Testing strategy

- **Unit tests** for RPC function logic (via `pgTAP` or integration tests
  against a local Supabase instance), especially concurrency edge cases
  (two simultaneous transfers draining the same account).
- **Integration tests** for the Stripe webhook handler, including replayed
  and out-of-order events, to verify idempotency.
- **E2E tests** (Playwright) for the critical user journeys: sign up →
  MFA enroll → KYC → deposit → transfer → withdraw.
- CI must pass before merge; staging environment mirrors production
  config (minus live Stripe keys) for pre-release verification.

## 11. Open items carried into follow-up specs

- Security Hardening spec: WAF/CDN edge rules, fraud/anomaly detection on
  transfer patterns, secrets rotation policy, pen-test plan, incident
  response runbook, breach notification process.
- Scaling spec: connection pooling tuning (Supabase's PgBouncer pooler),
  caching strategy, queueing for write-heavy paths, autoscaling
  configuration, and load testing to validate 10k baseline / 20k burst
  concurrent users.
