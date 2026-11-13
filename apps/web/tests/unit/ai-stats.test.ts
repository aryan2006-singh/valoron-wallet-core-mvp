import { describe, it, expect } from 'vitest'
import { computeWeeklyStats, fallbackSummary, startOfWeekUtc, type WalletTxn } from '@/lib/ai/stats'

function txn(partial: Partial<WalletTxn> & Pick<WalletTxn, 'createdAt' | 'amountCents' | 'direction'>): WalletTxn {
  return { id: Math.random().toString(), type: 'p2p_transfer', status: 'completed', note: null, category: null, ...partial }
}

// Thursday 2026-11-12, so this week starts Monday 2026-11-09.
const NOW = new Date('2026-11-12T10:00:00Z')

describe('startOfWeekUtc', () => {
  it('returns the Monday of the week', () => {
    expect(startOfWeekUtc(NOW).toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(startOfWeekUtc(new Date('2026-11-15T23:59:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(startOfWeekUtc(new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z')
  })
})

describe('computeWeeklyStats', () => {
  const txns = [
    txn({ createdAt: '2026-11-10T12:00:00Z', amountCents: 3000, direction: 'debit', category: 'food' }),
    txn({ createdAt: '2026-11-11T12:00:00Z', amountCents: 1000, direction: 'debit', category: 'transport' }),
    txn({ createdAt: '2026-11-11T13:00:00Z', amountCents: 5000, direction: 'credit', type: 'deposit' }),
    txn({ createdAt: '2026-11-11T14:00:00Z', amountCents: 9999, direction: 'debit', status: 'failed' }),
    txn({ createdAt: '2026-11-03T12:00:00Z', amountCents: 2000, direction: 'debit', category: 'food' }),
  ]

  it('splits this week and last week and ignores non-completed rows', () => {
    const stats = computeWeeklyStats(txns, NOW)
    expect(stats.weekStart).toBe('2026-11-09')
    expect(stats.thisWeek).toEqual({
      inCents: 5000,
      outCents: 4000,
      count: 3,
      outByCategory: { food: 3000, transport: 1000 },
    })
    expect(stats.lastWeek.outCents).toBe(2000)
  })

  it('writes a plain summary with the week-on-week change and top category', () => {
    const text = fallbackSummary(computeWeeklyStats(txns, NOW))
    expect(text).toContain('you sent $40.00 and received $50.00')
    expect(text).toContain('100% more')
    expect(text).toContain('food')
  })

  it('handles an empty fortnight', () => {
    expect(fallbackSummary(computeWeeklyStats([], NOW))).toMatch(/No activity/)
  })
})
