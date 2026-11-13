import type { Category } from './categories'

export type WalletTxn = {
  id: string
  type: 'p2p_transfer' | 'deposit' | 'withdrawal'
  status: 'pending' | 'completed' | 'failed' | 'reversed'
  direction: 'credit' | 'debit'
  amountCents: number
  createdAt: string
  note: string | null
  category: Category | null
}

export type PeriodStats = {
  inCents: number
  outCents: number
  count: number
  /** Money out per category, completed transfers only. */
  outByCategory: Partial<Record<Category, number>>
}

export type WeeklyStats = {
  weekStart: string // YYYY-MM-DD, Monday (UTC)
  thisWeek: PeriodStats
  lastWeek: PeriodStats
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Monday 00:00 UTC of the week containing `date`. */
export function startOfWeekUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const daysSinceMonday = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - daysSinceMonday * DAY_MS)
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function summarizePeriod(txns: WalletTxn[]): PeriodStats {
  const stats: PeriodStats = { inCents: 0, outCents: 0, count: 0, outByCategory: {} }
  for (const t of txns) {
    if (t.status !== 'completed') continue
    stats.count += 1
    if (t.direction === 'credit') {
      stats.inCents += t.amountCents
    } else {
      stats.outCents += t.amountCents
      if (t.type === 'p2p_transfer') {
        const cat = t.category ?? 'other'
        stats.outByCategory[cat] = (stats.outByCategory[cat] ?? 0) + t.amountCents
      }
    }
  }
  return stats
}

/** Splits transactions into this week and last week (Monday-based, UTC). */
export function computeWeeklyStats(txns: WalletTxn[], now: Date): WeeklyStats {
  const thisStart = startOfWeekUtc(now).getTime()
  const lastStart = thisStart - 7 * DAY_MS
  const thisWeek = txns.filter((t) => Date.parse(t.createdAt) >= thisStart)
  const lastWeek = txns.filter((t) => {
    const ts = Date.parse(t.createdAt)
    return ts >= lastStart && ts < thisStart
  })
  return {
    weekStart: toIsoDate(new Date(thisStart)),
    thisWeek: summarizePeriod(thisWeek),
    lastWeek: summarizePeriod(lastWeek),
  }
}

export function topCategory(stats: PeriodStats): [Category, number] | null {
  const entries = Object.entries(stats.outByCategory) as [Category, number][]
  if (entries.length === 0) return null
  return entries.sort((a, b) => b[1] - a[1])[0]
}

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/**
 * Plain-language summary built without a model. Used when no Anthropic key
 * is configured or the model call fails, and as the n8n email body.
 */
export function fallbackSummary(stats: WeeklyStats): string {
  const { thisWeek, lastWeek } = stats
  if (thisWeek.count === 0 && lastWeek.count === 0) {
    return 'No activity in the last two weeks yet. Your weekly summary will show up here once you start sending or receiving money.'
  }
  const parts: string[] = []
  parts.push(`This week you sent ${dollars(thisWeek.outCents)} and received ${dollars(thisWeek.inCents)}.`)
  if (lastWeek.outCents > 0) {
    const change = Math.round(((thisWeek.outCents - lastWeek.outCents) / lastWeek.outCents) * 100)
    if (change !== 0) {
      parts.push(`That's ${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} going out than last week.`)
    } else {
      parts.push('Spending is level with last week.')
    }
  }
  const top = topCategory(thisWeek)
  if (top && top[0] !== 'other') parts.push(`Your biggest category was ${top[0]} at ${dollars(top[1])}.`)
  return parts.join(' ')
}
