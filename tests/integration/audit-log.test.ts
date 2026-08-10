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
