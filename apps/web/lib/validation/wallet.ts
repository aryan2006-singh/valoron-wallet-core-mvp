import { z } from 'zod'

export const transferSchema = z.object({
  recipientEmail: z.string().email('Enter a valid email address'),
  amountCents: z.number().int().positive().max(1_000_000), // $10,000 cap per transfer
})
export type TransferInput = z.infer<typeof transferSchema>

export const depositSchema = z.object({
  amountCents: z.number().int().min(100, 'Minimum deposit is $1').max(50_000_000),
})
export type DepositInput = z.infer<typeof depositSchema>

export const withdrawalSchema = z.object({
  amountCents: z.number().int().min(100, 'Minimum withdrawal is $1'),
})
export type WithdrawalInput = z.infer<typeof withdrawalSchema>
