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
  note?: string | null
}

export function TransactionList({ transactions }: { transactions: TransactionRow[] }) {
  if (transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions yet.</p>
  }
  return (
    <ul className="divide-y">
      {transactions.map((txn) => (
        <li key={txn.id}>
          <Link href={`/transactions/${txn.id}`} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium capitalize">{txn.type.replace('_', ' ')}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(txn.createdAt).toLocaleString()}
                {txn.note ? ` · ${txn.note}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={txn.direction === 'credit' ? 'text-green-600' : 'text-foreground'}>
                {txn.direction === 'credit' ? '+' : '-'}
                {formatCents(txn.amountCents)}
              </span>
              <Badge variant={txn.status === 'completed' ? 'default' : 'secondary'}>{txn.status}</Badge>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
