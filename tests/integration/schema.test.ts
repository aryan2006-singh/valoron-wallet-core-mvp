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
