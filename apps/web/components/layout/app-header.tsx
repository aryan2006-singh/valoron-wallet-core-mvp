'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountMenu } from '@/components/layout/account-menu'
import { PRIMARY_NAV, isActivePath } from '@/components/layout/nav-config'

export function AppHeader({
  email,
  fullName,
  mfaEnabled,
}: {
  email: string
  fullName: string | null
  mfaEnabled: boolean
}) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 bg-background/70 supports-backdrop-filter:backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-2 px-4 md:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 font-heading font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="size-4" />
          </span>
          Valoron
        </Link>

        {/* Desktop nav. The mobile equivalent is MobileTabBar — see
            nav-config.ts for why both read from one shared list. */}
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto">
          <AccountMenu email={email} fullName={fullName} mfaEnabled={mfaEnabled} />
        </div>
      </div>
    </header>
  )
}
