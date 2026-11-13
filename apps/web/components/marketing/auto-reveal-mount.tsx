'use client'

import { usePathname } from 'next/navigation'
import { AutoReveal } from './motion'

export function AutoRevealMount() {
  return <AutoReveal pathname={usePathname()} />
}
