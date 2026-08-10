import { describe, it, expect } from 'vitest'
import { applyLedgerSnapshot, type LedgerSnapshot } from '@/lib/wallet/ledger-snapshot'

describe('applyLedgerSnapshot', () => {
  it('applies a snapshot that is newer than the current one', () => {
    const current: LedgerSnapshot = { ledgerEntryId: 100, balanceCents: 10000 }
    const incoming: LedgerSnapshot = { ledgerEntryId: 101, balanceCents: 7500 }
    expect(applyLedgerSnapshot(current, incoming)).toEqual(incoming)
  })

  it('discards a snapshot older than the current one — the race this guards against', () => {
    // DashboardClient's live postgres_changes handler and its
    // post-subscribe catch-up fetch can resolve in either order. This is
    // the case where the catch-up fetch (started earlier, e.g. right
    // after the channel joins) resolves *after* a live event has already
    // applied a newer snapshot — without this guard, "last response
    // wins" would silently revert the displayed balance to stale data.
    const current: LedgerSnapshot = { ledgerEntryId: 101, balanceCents: 7500 }
    const stale: LedgerSnapshot = { ledgerEntryId: 100, balanceCents: 10000 }
    expect(applyLedgerSnapshot(current, stale)).toBe(current)
  })

  it('is idempotent when the same snapshot is applied twice', () => {
    const current: LedgerSnapshot = { ledgerEntryId: 101, balanceCents: 7500 }
    const same: LedgerSnapshot = { ledgerEntryId: 101, balanceCents: 7500 }
    expect(applyLedgerSnapshot(current, same)).toEqual(current)
  })

  it('produces the same final state regardless of application order', () => {
    const initial: LedgerSnapshot = { ledgerEntryId: 0, balanceCents: 0 }
    const older: LedgerSnapshot = { ledgerEntryId: 100, balanceCents: 10000 }
    const newer: LedgerSnapshot = { ledgerEntryId: 101, balanceCents: 7500 }

    const olderThenNewer = applyLedgerSnapshot(applyLedgerSnapshot(initial, older), newer)
    const newerThenOlder = applyLedgerSnapshot(applyLedgerSnapshot(initial, newer), older)

    expect(olderThenNewer).toEqual(newer)
    expect(newerThenOlder).toEqual(newer)
    expect(olderThenNewer).toEqual(newerThenOlder)
  })
})
