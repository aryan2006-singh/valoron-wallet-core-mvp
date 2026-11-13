'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { PRIMARY_NAV, isActivePath } from '@/components/layout/nav-config'

/**
 * Bottom tab bar for small screens, where the header's inline nav is
 * hidden. Account routes aren't here — they stay in the header's account
 * menu, which is visible at every breakpoint. The app layout reserves
 * bottom padding so this never covers page content.
 */
export function MobileTabBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] supports-backdrop-filter:backdrop-blur-md md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 text-[0.7rem] font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon className={cn('size-5', active && 'stroke-[2.25]')} />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
