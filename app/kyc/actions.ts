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
