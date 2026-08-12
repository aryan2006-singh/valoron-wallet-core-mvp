// Requires the local Supabase stack running: `npx supabase start`
import { test, expect } from '@playwright/test'
import { TOTP } from 'otpauth'

test('a signed-up user can complete MFA enrollment and reach the dashboard', async ({ page }) => {
  const email = `mfa-e2e-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('Str0ngPassword!')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/mfa/)

  const secretLocator = page.getByTestId('mfa-manual-key')
  await expect(secretLocator).toBeVisible()
  const secret = (await secretLocator.textContent())!.trim()

  const totp = new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' })
  await page.getByPlaceholder('6-digit code').fill(totp.generate())
  await page.getByRole('button', { name: /verify and continue/i }).click()

  await expect(page).toHaveURL(/\/dashboard/)
})
