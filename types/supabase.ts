// Regenerated from the real schema at the end of Task 4 via:
//   npx supabase gen types typescript --local > types/supabase.ts
// This placeholder just unblocks Task 2's client wrappers.
export type Database = {
  public: {
    Tables: Record<string, { Row: Record<string, unknown> }>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
  }
}
