'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BalanceCard } from '@/components/wallet/balance-card'
import { TransactionList, type TransactionRow } from '@/components/wallet/transaction-list'

// Shape of the `transactions` + embedded `ledger_entries!inner` join used
// below — the generated Supabase types for an embedded-resource select
// don't structurally match this exactly, so this is asserted rather than
// inferred (same convention as the RPC `Json` casts elsewhere in this
// project), instead of widening to `any`.
type TxnJoinRow = {
  id: string
  type: TransactionRow['type']
  status: TransactionRow['status']
  created_at: string
  ledger_entries: { amount_cents: number; direction: TransactionRow['direction']; account_id: string }[]
}

export function DashboardClient({
  accountId,
  initialBalanceCents,
  initialTransactions,
}: {
  accountId: string
  initialBalanceCents: number
  initialTransactions: TransactionRow[]
}) {
  const [balanceCents, setBalanceCents] = useState(initialBalanceCents)
  const [transactions, setTransactions] = useState(initialTransactions)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`account-${accountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ledger_entries', filter: `account_id=eq.${accountId}` },
        (payload) => {
          const row = payload.new as { balance_after_cents: number }
          setBalanceCents(row.balance_after_cents)
          // Refetching the list on each event keeps this simple and
          // correct at this MVP's scale; the Scaling spec revisits
          // whether that still holds at 10k-20k concurrent users.
          supabase
            .from('transactions')
            .select('id, type, status, created_at, ledger_entries!inner(amount_cents, direction, account_id)')
            .eq('ledger_entries.account_id', accountId)
            .order('created_at', { ascending: false })
            .limit(20)
            .then(({ data }) => {
              if (!data) return
              setTransactions(
                (data as unknown as TxnJoinRow[]).map((t) => ({
                  id: t.id,
                  type: t.type,
                  status: t.status,
                  createdAt: t.created_at,
                  amountCents: t.ledger_entries[0].amount_cents,
                  direction: t.ledger_entries[0].direction,
                }))
              )
            })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId])

  return (
    <div className="space-y-6 p-8">
      <BalanceCard balanceCents={balanceCents} />
      <div>
        <h2 className="mb-2 text-lg font-medium">Recent activity</h2>
        <TransactionList transactions={transactions} />
      </div>
    </div>
  )
}
