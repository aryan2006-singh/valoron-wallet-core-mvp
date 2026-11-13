import Link from 'next/link'

const LABEL = 'font-mono text-xs tracking-widest uppercase'

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-medium tracking-tight">
            valoron<span className="size-1.5 rounded-full bg-primary" />
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            A wallet built on an append-only double-entry ledger, so every balance can be proven, not just trusted.
          </p>
        </div>
        <nav className={`flex gap-8 text-muted-foreground ${LABEL}`}>
          <Link href="/login" className="hover:text-foreground">
            Log in
          </Link>
          <Link href="/signup" className="hover:text-foreground">
            Create account
          </Link>
        </nav>
      </div>
      <div className="border-t">
        <div
          className={`mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 text-muted-foreground sm:flex-row sm:justify-between ${LABEL}`}
        >
          <p>© {new Date().getFullYear()} Valoron</p>
          <p>Payments by Stripe · Balances in USD</p>
        </div>
      </div>
    </footer>
  )
}
