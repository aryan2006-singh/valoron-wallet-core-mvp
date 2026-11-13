import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { isCategory } from './categories'
import type { WalletTxn } from './stats'

type Client = SupabaseClient<Database>

// Same embedded-resource cast convention as app/(app)/dashboard/page.tsx.
type TxnJoinRow = {
  id: string
  type: WalletTxn['type']
  status: WalletTxn['status']
  created_at: string
  note: string | null
  category: string | null
  ledger_entries: { amount_cents: number; direction: WalletTxn['direction']; account_id: string }[]
}

/**
 * Reads the signed-in user's own transactions. Every AI feature goes
 * through this with the *user's* Supabase client (never the service-role
 * one), so row-level security is what guarantees a prompt can only ever
 * contain the caller's own data, whatever the model asks for.
 */
export async function fetchTransactions(
  supabase: Client,
  accountId: string,
  opts: { from?: string; to?: string; limit?: number } = {}
): Promise<WalletTxn[]> {
  let query = supabase
    .from('transactions')
    .select('id, type, status, created_at, note, category, ledger_entries!inner(amount_cents, direction, account_id)')
    .eq('ledger_entries.account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 500))
  if (opts.from) query = query.gte('created_at', opts.from)
  if (opts.to) query = query.lt('created_at', opts.to)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return ((data ?? []) as unknown as TxnJoinRow[]).map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    direction: t.ledger_entries[0].direction,
    amountCents: t.ledger_entries[0].amount_cents,
    createdAt: t.created_at,
    note: t.note,
    category: isCategory(t.category) ? t.category : null,
  }))
}

export async function fetchBalanceCents(supabase: Client, accountId: string): Promise<number> {
  const { data } = await supabase
    .from('ledger_entries')
    .select('balance_after_cents')
    .eq('account_id', accountId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.balance_after_cents ?? 0
}

export async function fetchOwnAccountId(supabase: Client, userId: string): Promise<string | null> {
  const { data } = await supabase.from('accounts').select('id').eq('user_id', userId).maybeSingle()
  return data?.id ?? null
}
