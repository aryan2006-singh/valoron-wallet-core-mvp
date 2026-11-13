import Link from 'next/link'
import { formatCents } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function BalanceCard({ balanceCents }: { balanceCents: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-xs tracking-widest text-muted-foreground uppercase">Balance</CardTitle>
      </CardHeader>
      <CardContent>
        <p data-testid="balance-amount" className="font-heading font-light text-6xl tracking-tight text-primary">
          {formatCents(balanceCents)}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {/* This project's Button (Base UI, not Radix) has no `asChild` —
              use its `render` prop with the target element instead. */}
          <Button nativeButton={false} render={<Link href="/send">Send</Link>} size="default" />
          <Button nativeButton={false} render={<Link href="/deposit">Deposit</Link>} variant="outline" size="default" />
          <Button nativeButton={false} render={<Link href="/withdraw">Withdraw</Link>} variant="outline" size="default" />
        </div>
      </CardContent>
    </Card>
  )
}
