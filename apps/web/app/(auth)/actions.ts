'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { signUpSchema } from '@/lib/validation/auth'
import { loginRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { logger, maskEmail } from '@/lib/logger'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })

// Auth logging deliberately records the *outcome* and the masked account,
// never the submitted password. `parsed.data` is never spread into a log
// call for that reason.
const authLog = logger.child({ area: 'auth' })

async function clientContext() {
  const h = await headers()
  return {
    ip: h.get('x-forwarded-for') ?? 'unknown',
    userAgent: h.get('user-agent') ?? 'unknown',
  }
}

// These actions are invoked as plain async calls from client components
// (`await signUpAction(formData)` inside startTransition), not via a native
// `<form action={fn}>`. redirect()'s client-side navigation on that call
// path isn't reliable, so callers navigate themselves off an explicit
// { redirectTo } result instead of relying on redirect() to throw through.
export async function signUpAction(formData: FormData): Promise<{ error: string } | { redirectTo: string }> {
  const ctx = await clientContext()
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
  })
  if (!parsed.success) {
    authLog.info({ ...ctx, reason: parsed.error.issues[0].message }, 'signup rejected: validation failed')
    return { error: parsed.error.issues[0].message }
  }

  const email = maskEmail(parsed.data.email)
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  })
  if (error) {
    authLog.warn({ ...ctx, email, err: error.message }, 'signup failed')
    return { error: error.message }
  }

  authLog.info({ ...ctx, email, userId: data.user?.id }, 'signup succeeded')
  return { redirectTo: '/mfa' }
}

export async function signOutAction(): Promise<{ redirectTo: string }> {
  const ctx = await clientContext()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.auth.signOut()
  if (error) {
    authLog.warn({ ...ctx, userId: user?.id, err: error.message }, 'sign out failed')
  } else {
    authLog.info({ ...ctx, userId: user?.id }, 'sign out succeeded')
  }
  return { redirectTo: '/login' }
}

export async function logInAction(formData: FormData): Promise<{ error: string } | { redirectTo: string }> {
  const ctx = await clientContext()
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    authLog.info(ctx, 'login rejected: malformed credentials')
    return { error: 'Enter a valid email and password' }
  }

  const email = maskEmail(parsed.data.email)
  const allowed = await enforceRateLimit(loginRateLimit, `${ctx.ip}:${parsed.data.email}`)
  if (!allowed) {
    // Worth a warn rather than info: repeated hits here are the signal
    // for credential stuffing against a single account.
    authLog.warn({ ...ctx, email }, 'login blocked: rate limit exceeded')
    return { error: 'Too many login attempts. Try again in a minute.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    authLog.warn({ ...ctx, email, err: error.message }, 'login failed: invalid credentials')
    return { error: 'Invalid email or password' }
  }

  authLog.info({ ...ctx, email, userId: data.user?.id }, 'login succeeded')
  return { redirectTo: '/dashboard' }
}
