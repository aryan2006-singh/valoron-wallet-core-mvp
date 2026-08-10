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
