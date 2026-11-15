'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { createDepositIntent } from './actions'
import { depositSchema } from '@/lib/validation/wallet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function DepositPage() {
  const [amount, setAmount] = useState('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleStart() {
    setError(null)
    const amountCents = Math.round(parseFloat(amount) * 100)
    const parsed = depositSchema.safeParse({ amountCents })
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    startTransition(async () => {
      const result = await createDepositIntent(amountCents)
      if ('error' in result) setError(result.error)
      else setClientSecret(result.clientSecret)
    })
  }

  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <DepositConfirmForm />
      </Elements>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Deposit money</CardTitle>
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
          <Button onClick={handleStart} className="w-full" disabled={isPending}>
            {isPending ? 'Preparing…' : 'Continue'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function DepositConfirmForm() {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Stays false until the card number, expiry and CVC are all filled in, so
  // Confirm can't be pressed on an empty or half-filled form.
  const [isComplete, setIsComplete] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setIsSubmitting(true)
    setError(null)

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/dashboard` },
    })
    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed')
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-sm space-y-4">
      {/* Card first, shown as an open form: the default accordion layout hid
          the card fields behind a "Card" row that users missed. */}
      <PaymentElement
        options={{ layout: 'tabs', paymentMethodOrder: ['card'] }}
        onChange={(event) => setIsComplete(event.complete)}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={!stripe || !isComplete || isSubmitting}>
        {isSubmitting ? 'Processing…' : 'Confirm deposit'}
      </Button>
    </form>
  )
}
