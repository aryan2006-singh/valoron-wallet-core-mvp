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
