// Requires the local Supabase stack running: `npx supabase start`
import { test, expect, type Page } from '@playwright/test'
import { TOTP } from 'otpauth'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const admin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function signUpAndEnrollMfa(page: Page, email: string) {
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Critical Path User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('Str0ngPassword!')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/mfa/)

  const secret = (await page.getByTestId('mfa-manual-key').textContent())!.trim()
  const totp = new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' })
  await page.getByPlaceholder('6-digit code').fill(totp.generate())
  await page.getByRole('button', { name: /verify and continue/i }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('signup, fund, and send money end to end through the real UI', async ({ page, browser }) => {
  const senderEmail = `critical-sender-${Date.now()}@example.com`
  const recipientEmail = `critical-recipient-${Date.now()}@example.com`

  // Recipient signs up in a separate browser context so they exist for
  // the sender to look up by email, and stays open to check their
  // balance after the transfer.
  const recipientContext = await browser.newContext()
  const recipientPage = await recipientContext.newPage()
  await signUpAndEnrollMfa(recipientPage, recipientEmail)

  await signUpAndEnrollMfa(page, senderEmail)

  // Fund the sender directly (see Scoping notes above for why).
  const { data: usersData } = await admin.auth.admin.listUsers()
  const senderUser = usersData.users.find((u) => u.email === senderEmail)!
  const { data: senderAccount } = await admin.from('accounts').select('id').eq('user_id', senderUser.id).single()
  await admin.rpc('record_deposit', {
    p_account_id: senderAccount!.id,
    p_amount_cents: 10000,
    p_stripe_reference: 'pi_test_critical_path',
    p_idempotency_key: `critical-path-fund-${Date.now()}`,
  })

  await page.goto('/dashboard')
  await expect(page.getByTestId('balance-amount')).toHaveText('$100.00')

  await page.goto('/send')
  await page.getByPlaceholder("Recipient's email").fill(recipientEmail)
  await page.getByPlaceholder('Amount in USD').fill('25')
  await page.getByRole('button', { name: /^send$/i }).click()
  await expect(page.getByText('Sent!')).toBeVisible()

  await page.goto('/dashboard')
  await expect(page.getByTestId('balance-amount')).toHaveText('$75.00')

  await recipientPage.goto('/dashboard')
  await expect(recipientPage.getByTestId('balance-amount')).toHaveText('$25.00')

  await recipientContext.close()
})
