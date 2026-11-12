'use client'

import { useState } from 'react'
import { sendMoney } from './actions'
import { transferSchema } from '@/lib/validation/wallet'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SendMoneyPage() {
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [sentOptimistically, setSentOptimistically] = useState(false)

  async function handleSubmit() {
    const amountCents = Math.round(parseFloat(amount) * 100)
    const parsed = transferSchema.safeParse({ recipientEmail: email, amountCents })
    if (!parsed.success) {
      toast.add({ type: 'error', title: 'Could not send', description: parsed.error.issues[0].message })
      return
    }

    // Optimistic: show the confirmation immediately instead of waiting on
    // the round trip. If the server rejects it, roll back to the form and
    // surface exactly why via a toast.
    setSentOptimistically(true)
    const result = await sendMoney(email, amountCents)
    if ('error' in result) {
      setSentOptimistically(false)
      toast.add({ type: 'error', title: 'Transfer failed', description: result.error })
    }
  }

  if (sentOptimistically) {
    return (
      <div className="mx-auto w-full max-w-sm">
        <p className="text-muted-foreground">Sent!</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-3xl font-extralight tracking-[-0.04em] text-primary">Send money</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="email"
            placeholder="Recipient's email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Amount in USD"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
          />
          <Button onClick={handleSubmit} className="w-full">
            Send
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
