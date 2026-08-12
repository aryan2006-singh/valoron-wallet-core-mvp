import Link from 'next/link'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'

const SECTIONS = [
  { href: '#features', label: 'Features' },
  { href: '#security', label: 'Security' },
  { href: '#how-it-works', label: 'How it works' },
]

/**
 * Public marketing header. `isSignedIn` comes from the server so a
 * returning user sees a route into the product instead of being asked to
 * log in again.
 */
export function SiteHeader({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 supports-backdrop-filter:backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2 font-heading font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="size-4" />
          </span>
          Valoron
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {SECTIONS.map(({ href, label }) => (
            <Link key={href} href={href} className="transition-colors hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isSignedIn ? (
            <Button size="sm" nativeButton={false} render={<Link href="/dashboard">Go to wallet</Link>} />
          ) : (
            <>
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/login">Log in</Link>} />
              <Button size="sm" nativeButton={false} render={<Link href="/signup">Get started</Link>} />
            </>
          )}
        </div>
      </div>
    </header>
  )
}
