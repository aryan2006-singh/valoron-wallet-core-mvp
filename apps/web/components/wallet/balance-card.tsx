import Link from 'next/link'
import { formatCents } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function BalanceCard({ balanceCents }: { balanceCents: number }) {
  return (
    <Card className="relative overflow-hidden bg-[radial-gradient(120%_140%_at_100%_0%,color-mix(in_oklch,var(--primary)_14%,var(--card))_0%,var(--card)_55%)]">
      <CardHeader>
        <CardTitle className="eyebrow">Available balance</CardTitle>
      </CardHeader>
      <CardContent>
        <p data-testid="balance-amount" className="text-6xl font-extralight tracking-[-0.05em] text-primary tabular-nums sm:text-7xl">
          {formatCents(balanceCents)}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
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
