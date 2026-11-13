import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/wallet/dashboard-client'
import { InsightsCard, InsightsCardSkeleton } from '@/components/wallet/insights-card'
import type { TransactionRow } from '@/components/wallet/transaction-list'

// See components/wallet/dashboard-client.tsx's TxnJoinRow comment — same
// embedded-resource typing gap, same cast convention.
type TxnJoinRow = {
  id: string
  type: TransactionRow['type']
  status: TransactionRow['status']
  created_at: string
  note: string | null
  ledger_entries: { amount_cents: number; direction: TransactionRow['direction']; account_id: string }[]
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: account } = await supabase.from('accounts').select('id').eq('user_id', user.id).single()
  if (!account) redirect('/login')

  const { data: latestEntry } = await supabase
    .from('ledger_entries')
    .select('id, balance_after_cents')
    .eq('account_id', account.id)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: txnRows } = await supabase
    .from('transactions')
    .select('id, type, status, created_at, note, ledger_entries!inner(amount_cents, direction, account_id)')
    .eq('ledger_entries.account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const transactions: TransactionRow[] = ((txnRows ?? []) as unknown as TxnJoinRow[]).map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    createdAt: t.created_at,
    amountCents: t.ledger_entries[0].amount_cents,
    direction: t.ledger_entries[0].direction,
    note: t.note,
  }))

  return (
    <DashboardClient
      accountId={account.id}
      initialBalanceCents={latestEntry?.balance_after_cents ?? 0}
      initialLedgerEntryId={latestEntry?.id ?? 0}
      initialTransactions={transactions}
      insights={
        <Suspense fallback={<InsightsCardSkeleton />}>
          <InsightsCard userId={user.id} accountId={account.id} />
        </Suspense>
      }
    />
  )
}
