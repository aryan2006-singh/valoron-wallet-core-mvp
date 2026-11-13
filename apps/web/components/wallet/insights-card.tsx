import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getWeeklyInsight } from '@/lib/ai/insights'
import { formatCents } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Weekly spending summary. A server component streamed in behind
 * <Suspense> so a slow model call never holds up the balance above it.
 */
export async function InsightsCard({ userId, accountId }: { userId: string; accountId: string }) {
  const supabase = await createClient()
  let insight: Awaited<ReturnType<typeof getWeeklyInsight>> | null = null
  try {
    insight = await getWeeklyInsight(supabase, userId, accountId)
  } catch {
    insight = null
  }
  if (!insight) return null

  const { thisWeek } = insight.stats
  return (
    <Card data-testid="insights-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
          <Sparkles className="size-3.5" aria-hidden />
          This week
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{insight.summary}</p>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Money out</dt>
            <dd className="font-medium">{formatCents(thisWeek.outCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Money in</dt>
            <dd className="font-medium">{formatCents(thisWeek.inCents)}</dd>
          </div>
        </dl>
        <Link href="/assistant" className="inline-block text-sm text-primary underline-offset-4 hover:underline">
          Ask the assistant about your spending
        </Link>
      </CardContent>
    </Card>
  )
}

export function InsightsCardSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border p-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}
