import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppHeader } from '@/components/layout/app-header'
import { MobileTabBar } from '@/components/layout/mobile-tab-bar'
import { SetupPrompts } from '@/components/layout/setup-prompts'

/**
 * Shell for every signed-in route. Lives in the `(app)` route group so the
 * `(auth)` login/signup screens stay chrome-free (route groups don't affect
 * URLs — /dashboard is still /dashboard).
 *
 * Middleware already redirects anonymous users away from these paths; the
 * getUser() call here is what supplies the header's identity, and the
 * redirect below is defence in depth for the same reason the individual
 * pages already do it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, kyc_status')
    .eq('id', user.id)
    .single()

  const { data: factors } = await supabase.auth.mfa.listFactors()
  // See app/(app)/mfa/page.tsx — `.all` rather than `.totp`, whose status
  // this @supabase/auth-js version mistypes as the literal 'verified'.
  const mfaEnabled = factors?.all.some((f) => f.factor_type === 'totp' && f.status === 'verified') ?? false

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader email={user.email ?? ''} fullName={profile?.full_name ?? null} mfaEnabled={mfaEnabled} />
      {/* pb-24 clears the fixed MobileTabBar; it collapses at md, where
          the tab bar is hidden and the header's inline nav takes over. */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-24 md:px-6 md:pb-12">
        <SetupPrompts mfaEnabled={mfaEnabled} kycStatus={profile?.kyc_status ?? 'unverified'} />
        {children}
      </main>
      <MobileTabBar />
    </div>
  )
}
