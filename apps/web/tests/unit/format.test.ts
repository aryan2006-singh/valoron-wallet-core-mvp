import { describe, it, expect } from 'vitest'
import { formatCents } from '@/lib/format'

describe('formatCents', () => {
  it('formats a whole-dollar amount with thousands separators', () => {
    expect(formatCents(500000)).toBe('$5,000.00')
  })
  it('formats cents correctly', () => {
    expect(formatCents(1099)).toBe('$10.99')
  })
  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00')
  })
})
