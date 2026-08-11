import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatCents } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// See components/wallet/dashboard-client.tsx's TxnJoinRow comment — same
// embedded-resource typing gap, same cast convention.
type LedgerEntryRow = { amount_cents: number; direction: 'credit' | 'debit'; account_id: string }

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: transaction } = await supabase
    .from('transactions')
    .select('id, type, status, created_at, ledger_entries(amount_cents, direction, account_id)')
    .eq('id', id)
    .maybeSingle()
  if (!transaction) notFound()

  const { data: account } = await supabase.from('accounts').select('id').eq('user_id', user.id).single()
  const myEntry = (transaction.ledger_entries as unknown as LedgerEntryRow[]).find(
    (e) => e.account_id === account?.id
  )
  if (!myEntry) notFound() // RLS already hides other users' transactions; this is a defensive double-check

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="capitalize">{transaction.type.replace('_', ' ')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-3xl font-semibold">
            {myEntry.direction === 'credit' ? '+' : '-'}
            {formatCents(myEntry.amount_cents)}
          </p>
          <Badge variant={transaction.status === 'completed' ? 'default' : 'secondary'}>{transaction.status}</Badge>
          <p className="text-sm text-muted-foreground">{new Date(transaction.created_at).toLocaleString()}</p>
        </CardContent>
      </Card>
    </div>
  )
}
