import Link from 'next/link'
import { formatCents } from '@/lib/format'
import { Badge } from '@/components/ui/badge'

export type TransactionRow = {
  id: string
  type: 'p2p_transfer' | 'deposit' | 'withdrawal'
  status: 'pending' | 'completed' | 'failed' | 'reversed'
  amountCents: number
  direction: 'credit' | 'debit'
  createdAt: string
}

export function TransactionList({ transactions }: { transactions: TransactionRow[] }) {
  if (transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions yet.</p>
  }
  return (
    <ul className="stagger divide-y">
      {transactions.map((txn, index) => (
        <li key={txn.id} style={{ "--i": index } as React.CSSProperties}>
          <Link href={`/transactions/${txn.id}`} className="flex items-center justify-between gap-4 py-4 transition-colors hover:bg-muted/40">
            <div>
              <p className="text-sm font-medium capitalize">{txn.type.replace('_', ' ')}</p>
              <p className="text-xs text-muted-foreground">{new Date(txn.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-light tracking-tight tabular-nums ${txn.direction === 'credit' ? 'text-positive' : 'text-foreground'}`}>
                {txn.direction === 'credit' ? '+' : '-'}
                {formatCents(txn.amountCents)}
              </span>
              <Badge variant={txn.status === 'completed' ? 'outline' : 'secondary'}>{txn.status}</Badge>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
