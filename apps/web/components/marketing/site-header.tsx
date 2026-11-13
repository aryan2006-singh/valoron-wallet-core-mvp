import Link from 'next/link'

const SECTIONS = [
  { href: '#ledger', label: 'About' },
  { href: '#features', label: 'Features' },
  { href: '#security', label: 'Security' },
  { href: '#how-it-works', label: 'How it works' },
]

const MONO = 'font-mono text-xs tracking-widest uppercase'

/**
 * Public header, laid straight over the 3D stage with no bar behind it:
 * wordmark left, mono nav centred, account links right.
 */
export function SiteHeader({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-black/45 backdrop-blur-md">
      <div className="mx-auto grid h-16 w-full grid-cols-[1fr_auto] items-center gap-6 px-6 md:grid-cols-[1fr_auto_1fr]">
        <Link href="/" className="flex items-center gap-2 text-lg font-medium tracking-tight">
          <span className="grid size-5 place-items-center rounded-[5px] bg-primary text-[0.7rem] font-semibold text-primary-foreground">
            v
          </span>
          valoron
        </Link>

        <nav className={`hidden items-center gap-8 md:flex ${MONO}`}>
          {SECTIONS.map(({ href, label }) => (
            <Link key={href} href={href} className="text-muted-foreground transition-colors hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>

        <div className={`flex items-center justify-end gap-5 ${MONO}`}>
          {!isSignedIn && (
            <Link href="/login" className="text-muted-foreground transition-colors hover:text-foreground">
              Log in
            </Link>
          )}
          <Link
            href={isSignedIn ? '/dashboard' : '/signup'}
            className="inline-flex h-9 items-center rounded-md bg-secondary px-4 transition-colors hover:bg-white/15"
          >
            {isSignedIn ? 'Open wallet' : 'Get started'}
          </Link>
        </div>
      </div>
    </header>
  )
}
