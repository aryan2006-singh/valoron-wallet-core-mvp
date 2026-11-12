import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

/**
 * SECURITY: This client uses the service-role key and bypasses ALL Row
 * Level Security. Per the project's security baseline, it must be
 * imported ONLY from app/api/webhooks/stripe/route.ts and
 * lib/supabase/withdrawal-reversal.ts (a single-purpose wrapper around
 * reverse_withdrawal). Do not import this from any page, component, or
 * server action.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
