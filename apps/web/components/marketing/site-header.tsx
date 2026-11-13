import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const SECTIONS = [
  { href: '#features', label: 'Features' },
  { href: '#security', label: 'Security' },
  { href: '#how-it-works', label: 'How it works' },
]

/**
 * Public header, laid over the 3D stage with no bar behind it: wordmark,
 * a serif tagline, mono nav, and one square-ish button.
 */
export function SiteHeader({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-gradient-to-b from-black/85 to-transparent">
      <div className="mx-auto flex h-16 w-full items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-medium tracking-tight">
          valoron<span className="size-1.5 rounded-full bg-primary" />
        </Link>

        <p className="hidden flex-1 font-serif text-lg text-foreground/90 lg:block lg:pl-[12vw]">
          A wallet with a ledger that proves itself
        </p>

        <nav className="ml-auto hidden items-center gap-7 font-mono text-xs tracking-widest uppercase md:flex lg:ml-0">
          {SECTIONS.map(({ href, label }) => (
            <Link key={href} href={href} className="text-muted-foreground transition-colors hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {!isSignedIn && (
            <Link
              href="/login"
              className="px-3 font-mono text-xs tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
            >
              Log in
            </Link>
          )}
          <Link
            href={isSignedIn ? '/dashboard' : '/signup'}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-secondary px-4 text-sm font-medium transition-colors hover:bg-white/15"
          >
            <ArrowRight className="size-4" />
            {isSignedIn ? 'Open wallet' : 'Get started'}
          </Link>
        </div>
      </div>
    </header>
  )
}
