'use server'

import { createClient } from '@/lib/supabase/server'
import { assistantRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { chatHistorySchema, runAssistant, type AssistantResult, type ChatTurn } from '@/lib/ai/assistant'
import { fetchOwnAccountId } from '@/lib/ai/wallet-data'
import { logger } from '@/lib/logger'

const assistantLog = logger.child({ area: 'assistant' })

export async function askAssistant(history: ChatTurn[]): Promise<AssistantResult> {
  const parsed = chatHistorySchema.safeParse(history)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const allowed = await enforceRateLimit(assistantRateLimit, user.id)
  if (!allowed) return { error: 'You are sending messages too quickly. Try again in a minute.' }

  const accountId = await fetchOwnAccountId(supabase, user.id)
  if (!accountId) return { error: 'Wallet account not found' }

  try {
    const result = await runAssistant(supabase, accountId, parsed.data)
    // Log the size of the exchange, never its content: questions and
    // answers can contain amounts and notes.
    assistantLog.info({ userId: user.id, turns: parsed.data.length, ok: 'reply' in result }, 'assistant answered')
    return result
  } catch (err) {
    assistantLog.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) }, 'assistant failed')
    return { error: 'The assistant is unavailable right now. Please try again shortly.' }
  }
}
