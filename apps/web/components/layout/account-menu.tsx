'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Menu } from '@base-ui/react/menu'
import { BadgeCheck, ChevronDown, LogOut, Settings, ShieldCheck } from 'lucide-react'
import { signOutAction } from '@/app/(auth)/actions'
import { Button } from '@/components/ui/button'

const ITEM_CLASS =
  'flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted data-highlighted:text-foreground'

/** Initials for the avatar chip: full name if we have one, else the email. */
function initialsOf(fullName: string | null, email: string): string {
  const source = fullName?.trim() || email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

export function AccountMenu({
  email,
  fullName,
  mfaEnabled,
}: {
  email: string
  fullName: string | null
  mfaEnabled: boolean
}) {
  const router = useRouter()
  const [isSigningOut, startTransition] = useTransition()

  function handleSignOut() {
    startTransition(async () => {
      const { redirectTo } = await signOutAction()
      // Same convention as the login/signup actions: navigate off an
      // explicit redirectTo rather than relying on redirect() throwing
      // through a startTransition call. refresh() drops the cached RSC
      // payload so the signed-out shell can't flash stale user data.
      router.replace(redirectTo)
      router.refresh()
    })
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button variant="ghost" size="sm" className="gap-1.5 pr-1.5 pl-1" />}
        aria-label="Account menu"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[0.65rem] font-semibold text-primary-foreground">
          {initialsOf(fullName, email)}
        </span>
        <span className="hidden max-w-32 truncate sm:inline">{fullName || email}</span>
        <ChevronDown className="text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="min-w-56 origin-(--transform-origin) rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="px-2 py-1.5">
              {fullName && <p className="truncate text-sm font-medium">{fullName}</p>}
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <div className="my-1 h-px bg-border" />
            <Menu.Item
              className={ITEM_CLASS}
              render={
                <Link href="/settings">
                  <Settings />
                  Settings
                </Link>
              }
            />
            <Menu.Item
              className={ITEM_CLASS}
              render={
                // /mfa is a setup-only screen: once enrolled it immediately
                // redirects back to the dashboard, which from here looked
                // like the link did nothing. Send already-enrolled users to
                // Settings, where the real status lives, instead.
                <Link href={mfaEnabled ? '/settings' : '/mfa'}>
                  <ShieldCheck />
                  Two-factor authentication
                </Link>
              }
            />
            <Menu.Item
              className={ITEM_CLASS}
              render={
                <Link href="/kyc">
                  <BadgeCheck />
                  Verify identity
                </Link>
              }
            />
            <div className="my-1 h-px bg-border" />
            <Menu.Item className={`${ITEM_CLASS} text-destructive`} onClick={handleSignOut} disabled={isSigningOut}>
              <LogOut />
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
