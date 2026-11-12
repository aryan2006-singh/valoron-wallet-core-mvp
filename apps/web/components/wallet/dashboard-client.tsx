'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { applyLedgerSnapshot, type LedgerSnapshot } from '@/lib/wallet/ledger-snapshot'
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
  initialLedgerEntryId,
  initialTransactions,
}: {
  accountId: string
  initialBalanceCents: number
  initialLedgerEntryId: number
  initialTransactions: TransactionRow[]
}) {
  const [balanceCents, setBalanceCents] = useState(initialBalanceCents)
  const [transactions, setTransactions] = useState(initialTransactions)

  // Tracks the newest ledger snapshot applied so far, from whichever
  // source (live event or catch-up fetch) has reported it. See
  // lib/wallet/ledger-snapshot.ts for why this needs to be monotonic
  // rather than "last response wins".
  const latestSnapshotRef = useRef<LedgerSnapshot>({
    ledgerEntryId: initialLedgerEntryId,
    balanceCents: initialBalanceCents,
  })

  useEffect(() => {
    const supabase = createClient()

    function applySnapshot(incoming: LedgerSnapshot) {
      const next = applyLedgerSnapshot(latestSnapshotRef.current, incoming)
      if (next === latestSnapshotRef.current) return
      latestSnapshotRef.current = next
      setBalanceCents(next.balanceCents)
    }

    // Shared by the live event handler below and the post-subscribe
    // catch-up fetch, so both stay in sync with the same query/mapping.
    // `ledgerEntryId` is whichever ledger snapshot triggered this call;
    // if a newer snapshot has already been applied by the time this
    // resolves, its transactions list is provably stale too, so it's
    // discarded the same way applySnapshot discards a stale balance.
    async function refetchTransactions(ledgerEntryId: number) {
      try {
        const { data } = await supabase
          .from('transactions')
          .select('id, type, status, created_at, ledger_entries!inner(amount_cents, direction, account_id)')
          .eq('ledger_entries.account_id', accountId)
          .order('created_at', { ascending: false })
          .limit(20)
        if (!data || ledgerEntryId < latestSnapshotRef.current.ledgerEntryId) return
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
      } catch {
        // Best-effort refresh: the live subscription's next event (or a
        // future catch-up) retries this implicitly.
      }
    }

    // Runs once the channel is confirmed joined. Realtime only delivers
    // events that happen after the channel has joined. A ledger write
    // that lands between this page's server-rendered snapshot and this
    // callback — e.g. navigating here right after the send-money page's
    // optimistic "Sent!" confirmation, before its transfer has actually
    // committed — would otherwise never self-correct on this page load.
    // One snapshot fetch right after joining closes that gap; the
    // subscription below keeps things live from here on. It races with
    // the live handler (whichever resolves first), which is exactly what
    // applySnapshot/refetchTransactions's monotonicity checks are for.
    async function catchUp() {
      try {
        const { data } = await supabase
          .from('ledger_entries')
          .select('id, balance_after_cents')
          .eq('account_id', accountId)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!data) return
        applySnapshot({ ledgerEntryId: data.id, balanceCents: data.balance_after_cents })
        refetchTransactions(data.id)
      } catch {
        // Best-effort catch-up; the live subscription still covers
        // anything from here on.
      }
    }

    const channel = supabase
      .channel(`account-${accountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ledger_entries', filter: `account_id=eq.${accountId}` },
        (payload) => {
          const row = payload.new as { id: number; balance_after_cents: number }
          applySnapshot({ ledgerEntryId: row.id, balanceCents: row.balance_after_cents })
          // Refetching the list on each event keeps this simple and
          // correct at this MVP's scale; the Scaling spec revisits
          // whether that still holds at 10k-20k concurrent users.
          refetchTransactions(row.id)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') catchUp()
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId])

  return (
    <div className="space-y-6">
      <BalanceCard balanceCents={balanceCents} />
      <div>
        <h2 className="mb-3 font-heading text-3xl font-light tracking-[-0.04em] text-primary">Recent activity</h2>
        <TransactionList transactions={transactions} />
      </div>
    </div>
  )
}
