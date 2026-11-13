'use client'

import { useState, useTransition } from 'react'
import { createEscrow, releaseEscrow, refundEscrow } from './actions'
import { escrowSchema } from '@/lib/validation/wallet'
import { formatCents } from '@/lib/format'
import { toast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type EscrowRow = {
  id: string
  role: 'funder' | 'recipient'
  counterpartyName: string
  amountCents: number
  description: string | null
  status: 'held' | 'released' | 'refunded'
  createdAt: string
  expiresAt: string
  canRefund: boolean
}

export function EscrowClient({ escrows }: { escrows: EscrowRow[] }) {
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleCreate() {
    const amountCents = Math.round(parseFloat(amount) * 100)
    const parsed = escrowSchema.safeParse({ recipientEmail: email, amountCents, description })
    if (!parsed.success) {
      toast.add({ type: 'error', title: 'Could not hold funds', description: parsed.error.issues[0].message })
      return
    }
    startTransition(async () => {
      const result = await createEscrow(email, amountCents, description)
      if ('error' in result) {
        toast.add({ type: 'error', title: 'Could not hold funds', description: result.error })
      } else {
        setEmail('')
        setAmount('')
        setDescription('')
        toast.add({ type: 'success', title: 'Funds are now held in escrow' })
      }
    })
  }

  function handleResolve(id: string, action: 'release' | 'refund') {
    startTransition(async () => {
      const result = await (action === 'release' ? releaseEscrow(id) : refundEscrow(id))
      if ('error' in result) {
        toast.add({ type: 'error', title: `Could not ${action}`, description: result.error })
      } else {
        toast.add({ type: 'success', title: action === 'release' ? 'Funds released' : 'Funds refunded' })
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Hold funds in escrow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The amount leaves your balance now and is held safely. You release it to the recipient when you are
            satisfied; they can decline at any time, and you can take it back after it expires.
          </p>
          <Input type="email" placeholder="Recipient's email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            type="number"
            placeholder="Amount in USD"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
          />
          <Input
            placeholder="What is this for? (optional)"
            value={description}
            maxLength={140}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button onClick={handleCreate} className="w-full" disabled={isPending}>
            {isPending ? 'Working…' : 'Hold funds'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your escrows</CardTitle>
        </CardHeader>
        <CardContent>
          {escrows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No escrows yet.</p>
          ) : (
            <ul className="divide-y">
              {escrows.map((e) => (
                <li key={e.id} className="space-y-2 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {e.role === 'funder' ? 'To' : 'From'} {e.counterpartyName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {e.description ? `${e.description} · ` : ''}
                        {e.status === 'held'
                          ? `expires ${new Date(e.expiresAt).toLocaleDateString()}`
                          : new Date(e.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{formatCents(e.amountCents)}</span>
                      <Badge variant={e.status === 'held' ? 'default' : 'secondary'}>{e.status}</Badge>
                    </div>
                  </div>
                  {e.status === 'held' && (
                    <div className="flex gap-2">
                      {e.role === 'funder' && (
                        <Button size="sm" disabled={isPending} onClick={() => handleResolve(e.id, 'release')}>
                          Release
                        </Button>
                      )}
                      {e.canRefund && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => handleResolve(e.id, 'refund')}
                        >
                          {e.role === 'recipient' ? 'Decline' : 'Refund'}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
