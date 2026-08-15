'use server'

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { logger } from '@/lib/logger'

// The verification session URL is a one-time link to an identity flow, so
// it is returned to the caller but never logged — only the session id,
// which is what Stripe support and the webhook both key off.
const kycLog = logger.child({ area: 'kyc' })

export async function startKycVerification(): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    kycLog.warn('kyc denied: not authenticated')
    return { error: 'Not authenticated' }
  }

  let session
  try {
    session = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { user_id: user.id },
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
    })
  } catch (err) {
    kycLog.error({ userId: user.id, err }, 'kyc failed: could not create verification session')
    return { error: 'Could not start identity verification. Please try again.' }
  }

  const { error } = await supabase.rpc('request_kyc_verification')
  if (error) {
    kycLog.error(
      { userId: user.id, sessionId: session.id, err: error.message },
      'kyc failed: could not mark profile pending'
    )
    return { error: error.message }
  }

  kycLog.info({ userId: user.id, sessionId: session.id }, 'kyc verification started')
  return { url: session.url! }
}
