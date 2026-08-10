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
  const { data: txn, error: txnError } = await admin
    .from('transactions')
    .insert({
      type: 'deposit',
      status: 'completed',
      idempotency_key: `test-fund-${accountId}-${Date.now()}-${Math.random()}`,
    })
    .select()
    .single()
  if (txnError) throw txnError

  const { error: entryError } = await admin.from('ledger_entries').insert({
    account_id: accountId,
    transaction_id: txn!.id,
    amount_cents: amountCents,
    direction: 'credit',
    balance_after_cents: amountCents,
  })
  if (entryError) throw entryError
}
