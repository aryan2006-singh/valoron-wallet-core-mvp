import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Fingerprint,
  Handshake,
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
    icon: Handshake,
    title: 'Escrow',
    body: 'Lock funds for someone and release them when you are satisfied. Held money leaves your spendable balance at once, and a release or refund can only ever happen once.',
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
        <section className="relative overflow-hidden border-b">
          <HeroBackdrop />
          <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-28">
            <div className="space-y-7">
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-foreground/10">
                  <ShieldCheck className="size-3.5" />
                  Double-entry ledger · 2FA · Stripe
                </span>
              </Reveal>
              <h1 className="font-heading text-5xl leading-[1.02] font-light tracking-tighter text-balance sm:text-6xl lg:text-7xl">
                <RevealWords text="Move money on a ledger that proves itself." />
              </h1>
              <Reveal delay={0.16}>
                <p className="max-w-xl text-lg text-muted-foreground">
                  Valoron is a USD wallet built on append-only double-entry accounting. Every balance is
                  reconstructable from its own transaction history — never a single number in a column you have to
                  take on faith.
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
              <Reveal delay={0.32}>
                <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  {['No hidden balance column', 'Retry-safe by design', 'Full audit trail'].map((point) => (
                    <li key={point} className="flex items-center gap-1.5">
                      <Check className="size-4" />
                      {point}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>

            <HeroVisual />
          </div>
        </section>

        {/* Stats */}
        <section className="border-b bg-muted/40">
          <RevealGroup className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-14 sm:grid-cols-3">
            <Stat value={<CountUp to={77} />} label="Automated tests run on every change" />
            <Stat value={<CountUp to={100} suffix="%" />} label="Of balances derived from ledger history" />
            <Stat value={<CountUp to={0} />} label="Trusted balance columns anywhere in the schema" />
          </RevealGroup>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16 border-b">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <Reveal>
              <SectionHeading
                eyebrow="Features"
                title="Everything a wallet needs, done carefully"
                body="Each flow is built so the failure case is as well defined as the happy path."
              />
            </Reveal>
            <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="group rounded-xl bg-card p-6 ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:ring-foreground/20"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="mt-4 font-heading font-medium">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-16 border-b bg-primary text-primary-foreground">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.2fr]">
            <Reveal className="space-y-4">
              <span className="font-mono text-xs tracking-widest text-primary-foreground/75 uppercase">
                Security
              </span>
              <h2 className="font-heading text-3xl leading-tight font-light tracking-tighter text-balance sm:text-4xl">
                Correctness is the feature
              </h2>
              <p className="text-primary-foreground/80">
                Financial software fails in ways that are expensive and quiet. These are the guarantees that stop that
                from happening, enforced in the database rather than hoped for in application code.
              </p>
            </Reveal>
            <RevealGroup className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
              {GUARANTEES.map(({ icon: Icon, title, body }) => (
                <div key={title}>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10">
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="mt-4 font-heading font-medium">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-primary-foreground/80">{body}</p>
                </div>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-16 border-b">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <Reveal>
              <SectionHeading eyebrow="How it works" title="Up and running in three steps" />
            </Reveal>
            <RevealGroup className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map(({ n, title, body }) => (
                <div key={n} className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
                  <span className="font-mono text-sm text-muted-foreground">{n}</span>
                  <h3 className="mt-3 font-heading font-medium">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* Closing CTA */}
        <section>
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <Reveal>
              <div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-2xl bg-muted/60 px-6 py-14 text-center ring-1 ring-foreground/10">
                <h2 className="max-w-2xl font-heading text-3xl font-light tracking-tighter text-balance sm:text-4xl">
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
      <p className="font-heading text-4xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl space-y-3">
      <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{eyebrow}</span>
      <h2 className="font-heading text-3xl leading-tight font-light tracking-tighter text-balance sm:text-4xl">
        {title}
      </h2>
      {body && <p className="text-muted-foreground">{body}</p>}
    </div>
  )
}
