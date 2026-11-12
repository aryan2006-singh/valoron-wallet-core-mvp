'use client'

import { useState, useTransition } from 'react'
import { requestWithdrawal } from './actions'
import { withdrawalSchema } from '@/lib/validation/wallet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function WithdrawPage() {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    setError(null)
    const amountCents = Math.round(parseFloat(amount) * 100)
    const parsed = withdrawalSchema.safeParse({ amountCents })
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    startTransition(async () => {
      const result = await requestWithdrawal(amountCents)
      if ('error' in result) setError(result.error)
      else setSuccess(true)
    })
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm">
        <p className="text-center text-muted-foreground">
          Your withdrawal is on its way. It typically arrives in 1-3 business days.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-3xl font-extralight tracking-[-0.04em] text-primary">Withdraw money</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="number"
            placeholder="Amount in USD"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            step="0.01"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSubmit} className="w-full" disabled={isPending}>
            {isPending ? 'Processing…' : 'Withdraw'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
