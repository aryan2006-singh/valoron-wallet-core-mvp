'use client'

import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/components/marketing/motion'

/**
 * Ambient hero backdrop: slow drifting gradient orbs plus a soft spotlight
 * that tracks the pointer.
 *
 * The orbs animate purely in CSS (compositor-driven, no per-frame JS) and
 * the spotlight writes two CSS custom properties inside a rAF, so pointer
 * movement never triggers React renders. The native cursor is deliberately
 * left alone — replacing it looks clever for a second and then costs the
 * visitor every affordance the OS cursor gives them.
 */
export function HeroBackdrop() {
  const spotlightRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = spotlightRef.current
    if (!el || reduced) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0
    let x = 0
    let y = 0
    let queued = false

    function paint() {
      queued = false
      el!.style.setProperty('--spot-x', `${x}px`)
      el!.style.setProperty('--spot-y', `${y}px`)
    }

    function onMove(event: PointerEvent) {
      const rect = el!.getBoundingClientRect()
      x = event.clientX - rect.left
      y = event.clientY - rect.top
      if (!queued) {
        queued = true
        frame = requestAnimationFrame(paint)
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    el.style.opacity = '1'
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [reduced])

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-foreground/8 blur-3xl motion-safe:animate-[drift-a_22s_ease-in-out_infinite]" />
      <div className="absolute -right-32 -bottom-48 size-[30rem] rounded-full bg-foreground/6 blur-3xl motion-safe:animate-[drift-b_26s_ease-in-out_infinite]" />
      <div className="absolute top-1/4 left-1/2 size-[24rem] rounded-full bg-foreground/5 blur-3xl motion-safe:animate-[drift-c_30s_ease-in-out_infinite]" />
      <div
        ref={spotlightRef}
        className="absolute inset-0 opacity-0 transition-opacity duration-1000"
        style={{
          background:
            'radial-gradient(22rem circle at var(--spot-x, 50%) var(--spot-y, 30%), color-mix(in oklch, var(--foreground) 7%, transparent), transparent 70%)',
        }}
      />
    </div>
  )
}
