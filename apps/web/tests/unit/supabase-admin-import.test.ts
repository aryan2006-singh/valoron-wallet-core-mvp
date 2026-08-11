import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const ALLOWED_IMPORTERS = ['app/api/webhooks/stripe/route.ts']

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (['node_modules', '.next', '.git', 'tests'].includes(entry)) continue
    if (statSync(full).isDirectory()) walk(full, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

describe('supabase admin client import guard', () => {
  it('is only imported from the Stripe webhook route', () => {
    const root = path.resolve(__dirname, '../..')
    const offenders = walk(root)
      .filter((f) => f !== path.join(root, 'lib/supabase/admin.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes("from '@/lib/supabase/admin'"))
      .map((f) => path.relative(root, f).replace(/\\/g, '/'))
      .filter((relPath) => !ALLOWED_IMPORTERS.includes(relPath))

    expect(offenders).toEqual([])
  })
})
