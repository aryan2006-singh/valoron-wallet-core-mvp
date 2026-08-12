'use client'

import { useState, useTransition } from 'react'
import { startKycVerification } from './actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function KycPage() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleStart() {
    setError(null)
    startTransition(async () => {
      const result = await startKycVerification()
      if ('error' in result) setError(result.error)
      else window.location.href = result.url
    })
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Verify your identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Verifying your identity raises your withdrawal limit above $100 total. It takes about two minutes.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleStart} className="w-full" disabled={isPending}>
            {isPending ? 'Starting…' : 'Start verification'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
