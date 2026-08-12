// Requires the local Supabase stack running: `npx supabase start`
import { test, expect } from '@playwright/test'

test('a new user can sign up and is routed to MFA setup', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('Str0ngPassword!')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/mfa/)
})

test('an unauthenticated user is redirected away from the dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})
