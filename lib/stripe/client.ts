import Stripe from 'stripe'

// Pinned to the version this installed `stripe` SDK (v22) actually ships —
// the plan's original '2024-06-20' predates this SDK and fails the
// constructor's literal-typed apiVersion check.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-07-29.dahlia',
})
