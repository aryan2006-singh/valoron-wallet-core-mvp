import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default async function SettingsPage() {
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
  // See app/mfa/page.tsx's comment — .all (full status union) instead of
  // .totp (mistyped to the literal 'verified' by this @supabase/auth-js
  // version), same upstream typing gap, not a behavior change.
  const mfaEnabled = factors?.all.some((f) => f.factor_type === 'totp' && f.status === 'verified') ?? false

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>{profile?.full_name}</p>
          <p className="text-muted-foreground">{user.email}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant={mfaEnabled ? 'default' : 'secondary'}>{mfaEnabled ? 'Enabled' : 'Not set up'}</Badge>
          {!mfaEnabled && (
            // Without this the 2FA-gated actions (send/deposit/withdraw)
            // were unreachable for anyone who skipped enrolment at signup.
            <Button nativeButton={false} render={<Link href="/mfa">Set up 2FA</Link>} size="sm" />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Identity verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant={profile?.kyc_status === 'verified' ? 'default' : 'secondary'}>
            {profile?.kyc_status}
          </Badge>
          {profile?.kyc_status !== 'verified' && (
            // This project's Button (Base UI, not Radix) has no `asChild` —
            // use its `render` prop instead.
            <Button nativeButton={false} render={<Link href="/kyc">Verify identity</Link>} size="sm" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
