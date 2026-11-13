'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { logInAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
type LoginInput = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  function onSubmit(values: LoginInput) {
    setServerError(null)
    const formData = new FormData()
    formData.set('email', values.email)
    formData.set('password', values.password)
    startTransition(async () => {
      const result = await logInAction(formData)
      if ('error' in result) {
        setServerError(result.error)
        return
      }
      router.push(result.redirectTo)
    })
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-heading font-light text-4xl tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Log in to your Valoron wallet.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" placeholder="you@example.com" className="h-10" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-10"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {serverError && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            {isPending ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
      </Form>

      <p className="text-center text-sm text-muted-foreground">
        New to Valoron?{' '}
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
