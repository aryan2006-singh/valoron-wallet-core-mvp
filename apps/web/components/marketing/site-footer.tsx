import Link from 'next/link'
import { Wallet } from 'lucide-react'

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-[96rem] gap-8 px-6 py-12 md:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-3">
          <Link href="/" className="flex items-center gap-2 font-heading font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Wallet className="size-4" />
            </span>
            Valoron
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            A wallet built on an append-only double-entry ledger, so every balance can be proven, not just trusted.
          </p>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-medium">Product</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link href="#features" className="hover:text-foreground">
                Features
              </Link>
            </li>
            <li>
              <Link href="#security" className="hover:text-foreground">
                Security
              </Link>
            </li>
            <li>
              <Link href="#how-it-works" className="hover:text-foreground">
                How it works
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-medium">Account</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link href="/login" className="hover:text-foreground">
                Log in
              </Link>
            </li>
            <li>
              <Link href="/signup" className="hover:text-foreground">
                Create account
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Valoron. All rights reserved.</p>
          <p>Payments processed by Stripe. Balances held in USD.</p>
        </div>
      </div>
    </footer>
  )
}
