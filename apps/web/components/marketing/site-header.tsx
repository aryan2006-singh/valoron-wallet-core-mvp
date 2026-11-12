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
    <header className="sticky top-0 z-40 bg-gradient-to-b from-background via-background/70 to-transparent supports-backdrop-filter:backdrop-blur-[2px]">
      <div className="mx-auto flex h-20 w-full max-w-[96rem] items-center gap-6 px-6 sm:px-10">
        <Link href="/" className="flex items-center gap-2 font-heading font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Wallet className="size-4" />
          </span>
          Valoron
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-10 font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase md:flex">
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
