import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Fingerprint,
  Layers,
  Lock,
  ScrollText,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { HeroBackdrop } from '@/components/marketing/hero-backdrop'
import { HeroVisual } from '@/components/marketing/hero-visual'
import { CountUp, Magnetic, Reveal, RevealGroup, RevealWords } from '@/components/marketing/motion'

export const metadata: Metadata = {
  title: 'Valoron — A wallet with a ledger that proves itself',
  description:
    'Send, hold, and move money on an append-only double-entry ledger. Two-factor secured transfers, Stripe-powered deposits and payouts, and live balances.',
}

const FEATURES = [
  {
    icon: Send,
    title: 'Instant transfers',
    body: 'Send money to any Valoron user by email. Each transfer settles atomically in a single database transaction, so it either fully happens or not at all.',
  },
  {
    icon: ArrowDownLeft,
    title: 'Card deposits',
    body: 'Top up with any major card through Stripe. Funds are credited by a signature-verified webhook, never by trusting the browser.',
  },
  {
    icon: ArrowUpRight,
    title: 'Bank withdrawals',
    body: 'Move money out via Stripe payouts. If a payout cannot be initiated, the ledger entry reverses itself automatically and your balance is restored.',
  },
  {
    icon: Activity,
    title: 'Live balances',
    body: 'Balances stream over websockets and update the moment the ledger changes, ordered so a slow response can never overwrite fresher data.',
  },
  {
    icon: ShieldCheck,
    title: 'Two-factor by default',
    body: 'Authenticator-app enrolment is required before any money can leave an account. Every transfer re-checks it server side.',
  },
  {
    icon: BadgeCheck,
    title: 'Identity verification',
    body: 'Verify once through Stripe Identity to lift withdrawal limits. Status changes are applied by webhook, not by the client.',
  },
]

const GUARANTEES = [
  {
    icon: Layers,
    title: 'Append-only double-entry ledger',
    body: 'Every movement writes matching credit and debit rows. Nothing is ever edited or deleted, so history cannot be quietly rewritten.',
  },
  {
    icon: Lock,
    title: 'Row-level security on every table',
    body: 'Postgres policies plus explicit column grants mean a client can only ever read its own rows, even if application code has a bug.',
  },
  {
    icon: Fingerprint,
    title: 'Idempotency on every movement',
    body: 'Deposits, transfers, and withdrawals each carry a unique key, so a retry or a replayed webhook can never double-charge or double-credit.',
  },
  {
    icon: ScrollText,
    title: 'Immutable audit trail',
    body: 'Database triggers record every insert and update with the actor who caused it, giving a complete reconstruction of what happened.',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Create your account',
    body: 'Sign up with your email, then scan a QR code to turn on two-factor authentication.',
  },
  { n: '02', title: 'Add money', body: 'Deposit with a card. Stripe confirms the payment and the webhook credits your ledger.' },
  { n: '03', title: 'Send or withdraw', body: 'Transfer to any Valoron user instantly, or withdraw to your bank account.' },
]

export default async function LandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const primaryCta = user
    ? { href: '/dashboard', label: 'Go to your wallet' }
    : { href: '/signup', label: 'Create your account' }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader isSignedIn={Boolean(user)} />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative isolate -mt-20 flex min-h-svh flex-col justify-end overflow-hidden">
          <HeroBackdrop />
          <div className="absolute inset-0 -z-10 lg:left-[22%]">
            <HeroVisual />
          </div>
          <div className="relative mx-auto w-full max-w-[96rem] px-6 pb-24 pt-32 sm:px-10 sm:pb-28">
            <div className="max-w-5xl space-y-10">
              <Reveal>
                <span className="eyebrow inline-flex items-center gap-2">
                  <ShieldCheck className="size-3.5" />
                  Double-entry ledger · 2FA · Stripe
                </span>
              </Reveal>
              <h1 className="font-heading text-6xl leading-[0.92] font-extralight tracking-[-0.055em] text-balance text-primary sm:text-7xl lg:text-8xl">
                <RevealWords text="One wallet. A ledger that proves itself." />
              </h1>
              <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:gap-14">
                <Reveal delay={0.16}>
                  <p className="max-w-md text-lg leading-snug font-light text-foreground/80">
                    A USD wallet on append-only double-entry accounting. Every balance is reconstructable from its own
                    history, never a number you take on faith.
                  </p>
                </Reveal>
                <Reveal delay={0.24}>
                  <div className="flex flex-wrap items-center gap-3">
                    <Magnetic>
                      <Button
                        size="lg"
                        nativeButton={false}
                        render={
                          <Link href={primaryCta.href}>
                            {primaryCta.label}
                            <ArrowRight />
                          </Link>
                        }
                      />
                    </Magnetic>
                    {!user && (
                      <Magnetic strength={0.25}>
                        <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/login">Log in</Link>} />
                      </Magnetic>
                    )}
                  </div>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section>
          <RevealGroup className="mx-auto grid w-full max-w-[96rem] gap-10 px-6 py-24 sm:grid-cols-3 sm:px-10">
            <Stat value={<CountUp to={77} />} label="Automated tests run on every change" />
            <Stat value={<CountUp to={100} suffix="%" />} label="Of balances derived from ledger history" />
            <Stat value={<CountUp to={0} />} label="Trusted balance columns anywhere in the schema" />
          </RevealGroup>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16">
          <div className="mx-auto w-full max-w-[96rem] px-6 py-28 sm:px-10">
            <Reveal>
              <SectionHeading
                eyebrow="Features"
                title="Everything a wallet needs, done carefully"
                body="Each flow is built so the failure case is as well defined as the happy path."
              />
            </Reveal>
            <RevealGroup className="mt-16 border-t border-foreground/15">
              {FEATURES.map(({ icon: Icon, title, body }, i) => (
                <div
                  key={title}
                  className="group grid items-baseline gap-3 border-b border-foreground/15 py-8 transition-colors hover:bg-foreground/[0.03] md:grid-cols-[4rem_1fr_1.2fr] md:gap-8"
                >
                  <span className="eyebrow">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="flex items-center gap-4 font-heading text-3xl font-extralight tracking-[-0.035em] text-primary sm:text-4xl">
                    {title}
                    <Icon className="size-5 text-muted-foreground transition-colors group-hover:text-positive" />
                  </h3>
                  <p className="max-w-xl text-base leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-16 border-b bg-[radial-gradient(90%_120%_at_0%_0%,var(--card)_0%,var(--background)_65%)]">
          <div className="mx-auto grid w-full max-w-[96rem] gap-12 px-6 py-28 sm:px-10 lg:grid-cols-[1fr_1.2fr]">
            <Reveal className="space-y-4">
              <span className="eyebrow">Security</span>
              <h2 className="font-heading text-4xl leading-[1.02] font-light tracking-[-0.045em] text-balance text-primary sm:text-5xl">
                Correctness is the feature
              </h2>
              <p className="font-serif text-2xl leading-snug text-foreground/85">
                Financial software fails in ways that are expensive and quiet. These are the guarantees that stop that
                from happening, enforced in the database rather than hoped for in application code.
              </p>
            </Reveal>
            <RevealGroup className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
              {GUARANTEES.map(({ icon: Icon, title, body }) => (
                <div key={title}>
                  <span className="flex size-10 items-center justify-center rounded-full ring-1 ring-primary/40 text-primary">
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="mt-4 font-heading text-xl font-light tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-16 border-b">
          <div className="mx-auto w-full max-w-[96rem] px-6 py-28 sm:px-10">
            <Reveal>
              <SectionHeading eyebrow="How it works" title="Up and running in three steps" />
            </Reveal>
            <RevealGroup className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map(({ n, title, body }) => (
                <div key={n} className="rounded-[2rem] bg-card p-8 ring-1 ring-foreground/10">
                  <span className="eyebrow">{n}</span>
                  <h3 className="mt-4 font-heading text-xl font-light tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* Closing CTA */}
        <section>
          <div className="mx-auto w-full max-w-[96rem] px-6 py-28 sm:px-10">
            <Reveal>
              <div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl bg-[radial-gradient(120%_140%_at_50%_0%,var(--card)_0%,var(--background)_70%)] px-6 py-28 sm:px-10 text-center ring-1 ring-foreground/10">
                <h2 className="max-w-2xl font-heading text-4xl leading-[1.02] font-extralight tracking-[-0.045em] text-balance text-primary sm:text-6xl">
                  Open your wallet in under a minute
                </h2>
                <p className="max-w-xl text-muted-foreground">
                  Create an account, turn on two-factor authentication, and make your first deposit today.
                </p>
                <Magnetic>
                  <Button
                    size="lg"
                    nativeButton={false}
                    render={
                      <Link href={primaryCta.href}>
                        {user ? 'Go to your wallet' : 'Get started free'}
                        <ArrowRight />
                      </Link>
                    }
                  />
                </Magnetic>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <p className="border-b border-foreground/25 pb-3 font-mono text-7xl font-light tracking-[-0.04em] text-primary tabular-nums sm:text-8xl">{value}</p>
      <p className="mt-3 max-w-[16rem] text-lg leading-snug font-light text-foreground/80">{label}</p>
    </div>
  )
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl space-y-4">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="font-heading text-4xl leading-[1.02] font-light tracking-[-0.045em] text-balance text-primary sm:text-5xl">
        {title}
      </h2>
      {body && <p className="font-serif text-2xl leading-snug text-foreground/85">{body}</p>}
    </div>
  )
}
