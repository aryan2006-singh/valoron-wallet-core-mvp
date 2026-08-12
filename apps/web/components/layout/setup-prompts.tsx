'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Onboarding prompts for the two things a user must do before the app is
 * fully usable: enrol 2FA (gates send/deposit/withdraw) and verify
 * identity (raises the $100 withdrawal cap). Without these, both flows
 * are dead ends a new user would have no way to discover.
 *
 * Each prompt hides itself on the page it links to, so the destination
 * never renders a banner telling you to go where you already are.
 */
export function SetupPrompts({ mfaEnabled, kycStatus }: { mfaEnabled: boolean; kycStatus: string }) {
  const pathname = usePathname()

  const showMfa = !mfaEnabled && pathname !== '/mfa'
  const showKyc = mfaEnabled && kycStatus !== 'verified' && kycStatus !== 'pending' && pathname !== '/kyc'

  if (!showMfa && !showKyc) return null

  return (
    <div className="mb-6 space-y-3">
      {showMfa && (
        <Prompt
          icon={<ShieldCheck className="size-4" />}
          title="Set up two-factor authentication"
          body="Required before you can send, deposit, or withdraw money."
          href="/mfa"
          cta="Set up 2FA"
        />
      )}
      {showKyc && (
        <Prompt
          icon={<BadgeCheck className="size-4" />}
          title="Verify your identity"
          body="Raises your withdrawal limit above $100 total."
          href="/kyc"
          cta="Verify"
        />
      )}
    </div>
  )
}

function Prompt({
  icon,
  title,
  body,
  href,
  cta,
}: {
  icon: React.ReactNode
  title: string
  body: string
  href: string
  cta: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 ring-1 ring-foreground/10">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-foreground ring-1 ring-foreground/10">
        {icon}
      </span>
      <div className="min-w-40 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {/* Base UI Button has no `asChild` — use `render`, as elsewhere. */}
      <Button size="sm" nativeButton={false} render={<Link href={href}>{cta}</Link>} />
    </div>
  )
}
