export type LedgerSnapshot = {
  ledgerEntryId: number
  balanceCents: number
}

/**
 * Pure reducer for `DashboardClient`'s two ledger-balance sources: the
 * live `postgres_changes` INSERT handler and the post-subscribe catch-up
 * fetch (see that file for why both exist). They can resolve in either
 * order — a catch-up REST round-trip can finish after an already-open
 * WebSocket delivers a fresher event, e.g. under DB load — so "last to
 * resolve" is not the same as "latest data". Comparing on
 * `ledger_entries.id` (the ledger's own total order) rather than arrival
 * order keeps the displayed balance monotonic: an incoming snapshot only
 * replaces the current one if it's at least as new, so a slow, stale
 * response can never clobber an already-applied fresher balance.
 */
export function applyLedgerSnapshot(current: LedgerSnapshot, incoming: LedgerSnapshot): LedgerSnapshot {
  return incoming.ledgerEntryId >= current.ledgerEntryId ? incoming : current
}
