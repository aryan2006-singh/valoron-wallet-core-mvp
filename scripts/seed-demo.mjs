/**
 * Seeds the LOCAL Supabase stack with demo accounts and activity, so the
 * app can be shown to someone without hand-clicking through signup.
 *
 * Local only, by design: it needs the service-role key, which bypasses
 * RLS, and it writes ledger rows directly rather than going through the
 * deposit webhook. Never point this at a hosted project.
 *
 *   npm run seed:demo
 */
import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { TOTP } from 'otpauth'

const here = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(here, '../apps/web/.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error('Missing Supabase env vars. Expected apps/web/.env.local to be populated.')
  process.exit(1)
}
if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error(`Refusing to seed a non-local Supabase URL: ${SUPABASE_URL}`)
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PASSWORD = 'Demo1234!'
const PEOPLE = [
  { email: 'demo@valoron.local', name: 'Demo User', fundCents: 250_000, mfa: true },
  { email: 'alex@valoron.local', name: 'Alex Rivera', fundCents: 120_000, mfa: true },
  { email: 'priya@valoron.local', name: 'Priya Nair', fundCents: 80_000, mfa: false },
  { email: 'sam@valoron.local', name: 'Sam Okafor', fundCents: 45_000, mfa: false },
]

async function findUserByEmail(email) {
  // listUsers is paginated; these demo sets are tiny so one page is fine.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) throw error
  return data.users.find((u) => u.email === email) ?? null
}

async function ensureUser({ email, name }) {
  const existing = await findUserByEmail(email)
  if (existing) return { id: existing.id, created: false }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (error) throw error
  return { id: data.user.id, created: true }
}

async function accountIdFor(userId) {
  const { data, error } = await admin.from('accounts').select('id').eq('user_id', userId).single()
  if (error) throw error
  return data.id
}

async function currentBalance(accountId) {
  const { data } = await admin
    .from('ledger_entries')
    .select('balance_after_cents')
    .eq('account_id', accountId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.balance_after_cents ?? 0
}

/** Credits an account directly. Stands in for a settled Stripe deposit. */
async function fund(accountId, amountCents, label) {
  const { data: txn, error: txnError } = await admin
    .from('transactions')
    .insert({
      type: 'deposit',
      status: 'completed',
      idempotency_key: `seed-${label}-${accountId}-${Date.now()}-${Math.random()}`,
    })
    .select()
    .single()
  if (txnError) throw txnError

  const balance = await currentBalance(accountId)
  const { error } = await admin.from('ledger_entries').insert({
    account_id: accountId,
    transaction_id: txn.id,
    amount_cents: amountCents,
    direction: 'credit',
    balance_after_cents: balance + amountCents,
  })
  if (error) throw error
}

/** Enrols TOTP so the account can immediately use the 2FA-gated flows. */
async function enrolMfa(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInError) throw signInError

  const { data: factors } = await client.auth.mfa.listFactors()
  if (factors?.all.some((f) => f.factor_type === 'totp' && f.status === 'verified')) return null

  const { data: enrolled, error: enrolError } = await client.auth.mfa.enroll({ factorType: 'totp' })
  if (enrolError) throw enrolError

  const totp = new TOTP({ secret: enrolled.totp.secret, digits: 6, period: 30, algorithm: 'SHA1' })
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: enrolled.id })
  if (challengeError) throw challengeError

  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrolled.id,
    challengeId: challenge.id,
    code: totp.generate(),
  })
  if (verifyError) throw verifyError

  return enrolled.totp.secret
}

async function main() {
  const rows = []

  for (const person of PEOPLE) {
    const { id, created } = await ensureUser(person)
    const accountId = await accountIdFor(id)

    if (created && person.fundCents > 0) {
      await fund(accountId, person.fundCents, 'initial')
    }

    let secret = null
    if (person.mfa) {
      try {
        secret = await enrolMfa(person.email)
      } catch (err) {
        console.warn(`  ! MFA enrolment skipped for ${person.email}: ${err.message}`)
      }
    }

    rows.push({
      email: person.email,
      password: PASSWORD,
      '2FA': person.mfa ? 'enrolled' : 'not set up',
      // Only meaningful for accounts we just enrolled: an existing
      // enrolment's secret is not recoverable, and an account with no 2FA
      // has none at all.
      'TOTP secret': person.mfa ? (secret ?? '(enrolled earlier — secret not recoverable)') : '—',
      balance: `$${((await currentBalance(accountId)) / 100).toFixed(2)}`,
    })
  }

  console.log('\nDemo accounts ready:\n')
  console.table(rows)
  console.log('Sign in at http://localhost:3000/login\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
