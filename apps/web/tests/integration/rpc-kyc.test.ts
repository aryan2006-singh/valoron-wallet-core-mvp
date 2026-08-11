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
