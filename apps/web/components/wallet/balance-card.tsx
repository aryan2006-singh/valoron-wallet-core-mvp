import Link from 'next/link'
import { formatCents } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function BalanceCard({ balanceCents }: { balanceCents: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Balance</CardTitle>
      </CardHeader>
      <CardContent>
        <p data-testid="balance-amount" className="text-4xl font-semibold tracking-tight">
          {formatCents(balanceCents)}
        </p>
        <div className="mt-4 flex gap-2">
          {/* This project's Button (Base UI, not Radix) has no `asChild` —
              use its `render` prop with the target element instead. */}
          <Button nativeButton={false} render={<Link href="/send">Send</Link>} size="sm" />
          <Button nativeButton={false} render={<Link href="/deposit">Deposit</Link>} size="sm" variant="outline" />
          <Button nativeButton={false} render={<Link href="/withdraw">Withdraw</Link>} size="sm" variant="outline" />
        </div>
      </CardContent>
    </Card>
  )
}
