import { describe, it, expect } from 'vitest'
import { transferSchema, depositSchema, withdrawalSchema } from '@/lib/validation/wallet'
import { signUpSchema } from '@/lib/validation/auth'

describe('transferSchema', () => {
  it('accepts a valid transfer', () => {
    const result = transferSchema.safeParse({ recipientEmail: 'a@b.com', amountCents: 2000 })
    expect(result.success).toBe(true)
  })
  it('rejects a non-positive amount', () => {
    expect(transferSchema.safeParse({ recipientEmail: 'a@b.com', amountCents: 0 }).success).toBe(false)
  })
  it('rejects an invalid email', () => {
    expect(transferSchema.safeParse({ recipientEmail: 'not-an-email', amountCents: 100 }).success).toBe(false)
  })
})

describe('depositSchema', () => {
  it('rejects a deposit below the $1 minimum', () => {
    expect(depositSchema.safeParse({ amountCents: 50 }).success).toBe(false)
  })
})

describe('withdrawalSchema', () => {
  it('rejects a withdrawal below the $1 minimum', () => {
    expect(withdrawalSchema.safeParse({ amountCents: 50 }).success).toBe(false)
  })
})

describe('signUpSchema', () => {
  it('rejects a weak password', () => {
    expect(
      signUpSchema.safeParse({ email: 'a@b.com', password: 'short', fullName: 'A' }).success
    ).toBe(false)
  })
  it('accepts a strong password', () => {
    expect(
      signUpSchema.safeParse({ email: 'a@b.com', password: 'Str0ngPassword!', fullName: 'A' }).success
    ).toBe(true)
  })
})
