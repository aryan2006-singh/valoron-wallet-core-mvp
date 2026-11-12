import Link from 'next/link'
import { ArrowLeft, Layers, ShieldCheck, Wallet, Zap } from 'lucide-react'

const HIGHLIGHTS = [
  { icon: Layers, title: 'Double-entry ledger', body: 'Every cent is backed by matching credit and debit records.' },
  { icon: ShieldCheck, title: 'Two-factor secured', body: 'Money cannot leave your account without your authenticator.' },
  { icon: Zap, title: 'Live balances', body: 'Your balance updates the moment the ledger does.' },
]

/**
 * Chrome for the signed-out auth screens. The signed-in app shell lives in
 * app/(app)/layout.tsx; keeping them in separate route groups is why the
 * login page has no wallet navigation on it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — desktop only; the form carries its own logo on mobile. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r bg-[radial-gradient(110%_90%_at_100%_0%,var(--card)_0%,var(--background)_60%)] p-12 lg:flex">
        <Link href="/" className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Wallet className="size-4.5" />
          </span>
          Valoron
        </Link>

        <div className="space-y-10">
          <h2 className="max-w-md font-heading text-5xl leading-[1.02] font-extralight tracking-[-0.045em] text-balance text-primary">
            A wallet that can prove where every cent came from.
          </h2>
          <ul className="space-y-6">
            {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ring-primary/40 text-primary">
                  <Icon className="size-4.5" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="eyebrow">Payments processed by Stripe. Balances held in USD.</p>
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  )
}
