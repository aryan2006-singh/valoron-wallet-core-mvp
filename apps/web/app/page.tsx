import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { CountUp, Magnetic, Reveal, RevealGroup, RevealRows, RevealWords } from '@/components/marketing/motion'

export const metadata: Metadata = {
  title: 'Valoron — A wallet with a ledger that proves itself',
  description:
    'Send, hold, and move money on an append-only double-entry ledger. Two-factor secured transfers, Stripe-powered deposits and payouts, and live balances.',
}

const FEATURES = [
  {
    title: 'Instant transfers',
    body: 'Send money to any Valoron user by email. Each transfer settles atomically in a single database transaction, so it either fully happens or not at all.',
  },
  {
    title: 'Card deposits',
    body: 'Top up with any major card through Stripe. Funds are credited by a signature-verified webhook, never by trusting the browser.',
  },
  {
    title: 'Bank withdrawals',
    body: 'Move money out via Stripe payouts. If a payout cannot be initiated, the ledger entry reverses itself automatically and your balance is restored.',
  },
  {
    title: 'Live balances',
    body: 'Balances stream over websockets and update the moment the ledger changes, ordered so a slow response can never overwrite fresher data.',
  },
  {
    title: 'Two-factor by default',
    body: 'Authenticator-app enrolment is required before any money can leave an account. Every transfer re-checks it server side.',
  },
  {
    title: 'Identity verification',
    body: 'Verify once through Stripe Identity to lift withdrawal limits. Status changes are applied by webhook, not by the client.',
  },
]

const GUARANTEES = [
  {
    title: 'Append-only double-entry ledger',
    body: 'Every movement writes matching credit and debit rows. Nothing is ever edited or deleted, so history cannot be quietly rewritten.',
  },
  {
    title: 'Row-level security on every table',
    body: 'Postgres policies plus explicit column grants mean a client can only ever read its own rows, even if application code has a bug.',
  },
  {
    title: 'Idempotency on every movement',
    body: 'Deposits, transfers, and withdrawals each carry a unique key, so a retry or a replayed webhook can never double-charge or double-credit.',
  },
  {
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

  const primary = user ? { href: '/dashboard', label: 'Open wallet' } : { href: '/signup', label: 'Start a wallet' }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader isSignedIn={Boolean(user)} />

      <main className="flex-1">
        {/* Hero: the stage does the talking; copy sits low and left. */}
        <section className="relative flex min-h-svh flex-col justify-end px-6 pb-16 sm:pb-24">
          <div className="mx-auto w-full max-w-6xl">
            <h1 className="font-heading text-5xl leading-[1.05] font-light tracking-tight text-balance sm:text-7xl">
              <RevealWords text="One wallet. A clear ledger. Complete proof." />
            </h1>
            <Reveal delay={0.3}>
              <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10">
                <p className="max-w-sm text-sm leading-relaxed text-foreground/90">
                  A USD wallet on an append-only double-entry ledger: transfers, card deposits and bank withdrawals,
                  each one provable from its own history.
                </p>
                <Magnetic>
                  <Link
                    href={primary.href}
                    className="inline-flex h-10 items-center rounded-md bg-primary px-5 font-mono text-xs tracking-widest text-primary-foreground uppercase transition-opacity hover:opacity-85"
                  >
                    {primary.label}
                  </Link>
                </Magnetic>
              </div>
            </Reveal>
          </div>
        </section>

        <div className="[text-shadow:0_1px_16px_rgb(0_0_0/0.9)]">
          {/* About + stats */}
          <section id="ledger" className="mx-auto w-full max-w-6xl scroll-mt-16 px-6 py-28">
            <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              <RevealWords text="About" />
            </span>
            <p className="mt-6 max-w-4xl font-heading text-2xl leading-snug font-light tracking-tight text-balance sm:text-4xl">
              <RevealWords
                stagger={0.018}
                text="Valoron is a USD wallet built on append-only double-entry accounting. Every balance can be rebuilt from its own transaction history, so it is never a single number you have to take on faith."
              />
            </p>
            <RevealGroup className="mt-20 grid gap-10 border-t pt-10 sm:grid-cols-3">
              <Stat value={<CountUp to={77} />} label="Automated tests on every change" />
              <Stat value={<CountUp to={100} suffix="%" />} label="Of balances derived from ledger history" />
              <Stat value={<CountUp to={0} />} label="Trusted balance columns in the schema" />
            </RevealGroup>
          </section>

          <Listing id="features" eyebrow="What it does" items={FEATURES} />
          <Listing id="security" eyebrow="Why it is safe" items={GUARANTEES} />
          <Listing id="how-it-works" eyebrow="How it works" items={STEPS.map(({ title, body }) => ({ title, body }))} />

          {/* Closing */}
          <section className="mx-auto w-full max-w-6xl px-6 py-32 text-center">
            <h2 className="mx-auto max-w-3xl font-heading text-4xl leading-tight font-light tracking-tight text-balance sm:text-6xl">
              <RevealWords text="One wallet, open in under a minute." />
            </h2>
            <Reveal delay={0.3}>
              <div className="mt-10 flex justify-center">
                <Magnetic>
                  <Link
                    href={primary.href}
                    className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-8 font-mono text-xs tracking-widest text-primary-foreground uppercase transition-opacity hover:opacity-85"
                  >
                    {primary.label}
                    <ArrowUpRight className="size-4" />
                  </Link>
                </Magnetic>
              </div>
            </Reveal>
          </section>

          <SiteFooter />
        </div>
      </main>
    </div>
  )
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <p className="font-heading text-7xl font-light tracking-tight tabular-nums">{value}</p>
      <p className="mt-3 font-mono text-xs tracking-widest text-muted-foreground uppercase">{label}</p>
    </div>
  )
}

/** Hairline list: index, large light title, description. */
function Listing({
  id,
  eyebrow,
  items,
}: {
  id: string
  eyebrow: string
  items: { title: string; body: string }[]
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-16 px-6 py-20">
      <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
        <RevealWords text={eyebrow} />
      </span>
      <RevealRows className="mt-8">
        {/* Top rule draws in with the first row. */}
        {items.map(({ title, body }, i) => (
          <div
            key={title}
            data-row
            className="group relative grid gap-3 py-8 transition-colors hover:bg-white/[0.03] md:grid-cols-[4rem_1.2fr_1fr] md:gap-8"
          >
            {i === 0 && <span data-rule aria-hidden className="absolute inset-x-0 top-0 h-px bg-border" />}
            <span data-rule aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border" />
            <span data-row-part className="font-mono text-xs tracking-widest text-muted-foreground">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3
              data-row-part
              className="font-heading text-2xl font-light tracking-tight transition-colors group-hover:text-primary sm:text-3xl"
            >
              {title}
            </h3>
            <p data-row-part className="text-[15px] leading-relaxed font-medium text-foreground">
              {body}
            </p>
          </div>
        ))}
      </RevealRows>
    </section>
  )
}
