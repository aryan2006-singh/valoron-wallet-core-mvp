'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { signUpSchema } from '@/lib/validation/auth'
import { loginRateLimit, enforceRateLimit } from '@/lib/rate-limit'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })

// These actions are invoked as plain async calls from client components
// (`await signUpAction(formData)` inside startTransition), not via a native
// `<form action={fn}>`. redirect()'s client-side navigation on that call
// path isn't reliable, so callers navigate themselves off an explicit
// { redirectTo } result instead of relying on redirect() to throw through.
export async function signUpAction(formData: FormData): Promise<{ error: string } | { redirectTo: string }> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  })
  if (error) return { error: error.message }

  return { redirectTo: '/mfa' }
}

export async function signOutAction(): Promise<{ redirectTo: string }> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return { redirectTo: '/login' }
}

export async function logInAction(formData: FormData): Promise<{ error: string } | { redirectTo: string }> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: 'Enter a valid email and password' }

  const ip = (await headers()).get('x-forwarded-for') ?? 'unknown'
  const allowed = await enforceRateLimit(loginRateLimit, `${ip}:${parsed.data.email}`)
  if (!allowed) return { error: 'Too many login attempts. Try again in a minute.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: 'Invalid email or password' }

  return { redirectTo: '/dashboard' }
}
