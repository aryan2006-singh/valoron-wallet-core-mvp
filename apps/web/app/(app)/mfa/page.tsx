'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function MfaSetupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      // Use `.all` (typed with the full verified/unverified union) rather than
      // `.totp`, which this installed @supabase/auth-js version's types pin to
      // the literal 'verified' status regardless of actual runtime value —
      // an upstream typing gap, not a behavior change.
      const totpFactors = factors?.all.filter((f) => f.factor_type === 'totp') ?? []
      if (totpFactors.some((f) => f.status === 'verified')) {
        router.replace('/dashboard')
        return
      }
      const unverified = totpFactors.find((f) => f.status === 'unverified')
      if (unverified) await supabase.auth.mfa.unenroll({ factorId: unverified.id })

      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (error) {
        setError(error.message)
      } else {
        setQrCode(data.totp.qr_code)
        setSecret(data.totp.secret)
        setFactorId(data.id)
      }
      setLoading(false)
    }
    init()
  }, [])

  async function handleVerify() {
    if (!factorId) return
    setError(null)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) {
      setError(challengeError.message)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    })
    if (verifyError) {
      setError('Invalid code — try again.')
      return
    }
    router.replace('/dashboard')
  }

  if (loading) return <div className="flex justify-center py-12">Loading…</div>

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-3xl font-extralight tracking-[-0.04em] text-primary">Set up two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Valoron requires an authenticator app before you can send, deposit, or withdraw money.
          </p>
          {qrCode && (
            <img src={qrCode} alt="Scan this QR code with your authenticator app" className="mx-auto h-40 w-40" />
          )}
          {secret && (
            <p className="text-xs text-muted-foreground">
              Can&apos;t scan? Enter this key manually:{' '}
              <span data-testid="mfa-manual-key" className="font-mono">{secret}</span>
            </p>
          )}
          <Input
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleVerify} className="w-full" disabled={code.length !== 6}>
            Verify and continue
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
