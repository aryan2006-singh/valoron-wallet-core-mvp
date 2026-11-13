import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeWeeklyStats, fallbackSummary, startOfWeekUtc } from '@/lib/ai/stats'
import { fetchTransactions } from '@/lib/ai/wallet-data'
import { logger } from '@/lib/logger'

const n8nLog = logger.child({ area: 'n8n-weekly-insights' })

const PER_PAGE = 50

function authorized(request: Request): boolean {
  const secret = process.env.N8N_API_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Weekly digest feed for the n8n "weekly insights email" workflow
 * (n8n/workflows/weekly-insights-email.json).
 *
 * This is the only route besides the Stripe webhook allowed to use the
 * service-role client (see tests/unit/supabase-admin-import.test.ts): it
 * has to read every user's activity to build their digest. It is locked
 * behind N8N_API_SECRET, returns 404 when that secret isn't configured,
 * and only ever returns aggregates plus each user's own email address.
 *
 * GET /api/n8n/weekly-insights?page=1
 *   Authorization: Bearer <N8N_API_SECRET>
 * -> { page, nextPage, users: [{ email, fullName, weekStart, summary, thisWeek, lastWeek }] }
 * Users with no activity in the last two weeks are left out.
 */
export async function GET(request: Request) {
  if (!process.env.N8N_API_SECRET) return new Response('Not found', { status: 404 })
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 })

  const page = Math.max(1, Number(new URL(request.url).searchParams.get('page')) || 1)
  const admin = createAdminClient()

  const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
  if (error) {
    n8nLog.error({ err: error.message }, 'listUsers failed')
    return Response.json({ error: 'Could not list users' }, { status: 500 })
  }

  const now = new Date()
  const from = new Date(startOfWeekUtc(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const users = []
  for (const user of list.users) {
    if (!user.email) continue
    const { data: account } = await admin.from('accounts').select('id').eq('user_id', user.id).maybeSingle()
    if (!account) continue

    const txns = await fetchTransactions(admin, account.id, { from, limit: 500 })
    const stats = computeWeeklyStats(txns, now)
    if (stats.thisWeek.count === 0 && stats.lastWeek.count === 0) continue

    // Reuse the AI summary the user already saw on their dashboard this
    // week, if any; otherwise send the plain summary. This endpoint never
    // calls the model itself, so a cron run can't rack up model costs.
    const { data: cached } = await admin
      .from('weekly_insights')
      .select('summary')
      .eq('user_id', user.id)
      .eq('week_start', stats.weekStart)
      .maybeSingle()
    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

    users.push({
      email: user.email,
      fullName: profile?.full_name ?? null,
      weekStart: stats.weekStart,
      summary: cached?.summary ?? fallbackSummary(stats),
      thisWeek: stats.thisWeek,
      lastWeek: stats.lastWeek,
    })
  }

  const nextPage = list.users.length === PER_PAGE ? page + 1 : null
  n8nLog.info({ page, returned: users.length }, 'weekly insights served')
  return Response.json({ page, nextPage, users })
}
