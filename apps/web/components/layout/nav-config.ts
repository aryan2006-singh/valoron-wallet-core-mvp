import { ArrowDownLeft, ArrowUpRight, Handshake, Send, Settings, Wallet } from 'lucide-react'

/**
 * Single source of truth for the app's primary navigation. The desktop
 * header, the mobile tab bar, and the account menu all read from here so
 * a route can never be reachable in one surface but missing from another
 * (which is exactly how /settings ended up unreachable before).
 */
export type NavItem = {
  href: string
  label: string
  icon: typeof Wallet
}

/** Money-movement routes — shown in the header and the mobile tab bar. */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: Wallet },
  { href: '/send', label: 'Send', icon: Send },
  { href: '/deposit', label: 'Deposit', icon: ArrowDownLeft },
  { href: '/withdraw', label: 'Withdraw', icon: ArrowUpRight },
]

/**
 * Account routes. These live in the header's account menu rather than the
 * tab bar — they're occasional-use, unlike the money actions above.
 */
export const ACCOUNT_NAV: NavItem[] = [
  { href: '/escrow', label: 'Escrow', icon: Handshake },
  { href: '/settings', label: 'Settings', icon: Settings },
]

/** True when `pathname` is the given nav route or a child of it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
