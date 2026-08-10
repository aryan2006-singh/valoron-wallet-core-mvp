import { z } from 'zod'

export const signUpSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  fullName: z.string().min(1, 'Full name is required'),
})
export type SignUpInput = z.infer<typeof signUpSchema>
