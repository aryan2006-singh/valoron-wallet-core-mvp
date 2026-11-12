/**
 * Static mock of the signed-in wallet, built from the same design tokens
 * as the real dashboard so the marketing page cannot drift away from what
 * the product actually looks like. Doubles as the hero fallback whenever
 * the 3D scene is unavailable (no WebGL, or reduced motion requested).
 */
export function ProductPreview() {
  const rows = [
    { label: 'Deposit', meta: 'Visa ending 4242', amount: '+$500.00', positive: true },
    { label: 'Sent to alex@valoron.app', meta: 'P2P transfer', amount: '-$40.00', positive: false },
    { label: 'Withdrawal', meta: 'To bank account', amount: '-$120.00', positive: false },
  ]

  return (
    <div className="rounded-2xl bg-card p-5 shadow-xl ring-1 ring-foreground/10" aria-hidden>
      <p className="text-sm text-muted-foreground">Balance</p>
      <p className="mt-1 font-heading text-4xl font-semibold tracking-tight">$2,480.00</p>
      <div className="mt-4 flex gap-2">
        <span className="flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
          Send
        </span>
        <span className="flex h-8 items-center rounded-lg border px-3 text-sm font-medium">Deposit</span>
        <span className="flex h-8 items-center rounded-lg border px-3 text-sm font-medium">Withdraw</span>
      </div>
      <div className="mt-6 space-y-1">
        <p className="mb-2 text-sm font-medium">Recent activity</p>
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between border-t py-3 first:border-t-0">
            <div>
              <p className="text-sm font-medium">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.meta}</p>
            </div>
            <span className={`text-sm font-medium ${row.positive ? 'text-positive' : ''}`}>
              {row.amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
