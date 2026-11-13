import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EscrowClient, type EscrowRow } from './escrow-client'

export default async function EscrowPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase.rpc('my_escrows')
  const escrows: EscrowRow[] = (data ?? []).map((e) => ({
    id: e.id,
    role: e.role as EscrowRow['role'],
    counterpartyName: e.counterparty_name,
    amountCents: e.amount_cents,
    description: e.description,
    status: e.status as EscrowRow['status'],
    createdAt: e.created_at,
    expiresAt: e.expires_at,
    canRefund: e.can_refund,
  }))

  return <EscrowClient escrows={escrows} />
}
