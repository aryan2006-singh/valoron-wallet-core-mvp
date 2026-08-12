'use client'

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

/**
 * Every animation in this file is a no-op when the visitor has asked for
 * reduced motion. That is not optional polish — vestibular disorders make
 * large parallax and scroll-jacking genuinely painful, and an unreachable
 * page is worse than an unanimated one.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useReducedMotion(): boolean {
  // useSyncExternalStore rather than useEffect + setState: a media query is
  // exactly the "external store" this hook exists for, and it avoids the
  // cascading render that setting state inside an effect would cause.
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true // server snapshot — never animate during SSR/hydration
  )
}

/** Fades and lifts its children into view as they enter the viewport. */
export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          delay,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        }
      )
    })
    return () => ctx.revert()
  }, [delay, y, reduced])

  // Rendered visible by default; GSAP only takes over once we know motion
  // is welcome, so content is never trapped at opacity 0.
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

/** Counts a number up when it scrolls into view. */
export function CountUp({
  to,
  prefix = '',
  suffix = '',
  decimals = 0,
  className,
}: {
  to: number
  prefix?: string
  suffix?: string
  decimals?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()

  const format = (v: number) =>
    `${prefix}${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced) {
      el.textContent = format(to)
      return
    }

    const ctx = gsap.context(() => {
      const counter = { value: 0 }
      gsap.to(counter, {
        value: to,
        duration: 1.6,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        onUpdate: () => {
          el.textContent = format(counter.value)
        },
      })
    })
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, reduced, prefix, suffix, decimals])

  return (
    <span ref={ref} className={className}>
      {format(to)}
    </span>
  )
}

/**
 * Pulls its child gently toward the pointer. Skipped entirely on coarse
 * pointers (touch), where there is no hover to react to.
 */
export function Magnetic({ children, strength = 0.35 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    const quickX = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' })
    const quickY = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' })

    function onMove(event: MouseEvent) {
      const rect = el!.getBoundingClientRect()
      quickX((event.clientX - (rect.left + rect.width / 2)) * strength)
      quickY((event.clientY - (rect.top + rect.height / 2)) * strength)
    }
    function onLeave() {
      quickX(0)
      quickY(0)
    }

    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [strength, reduced])

  return (
    <div ref={ref} className="inline-flex will-change-transform">
      {children}
    </div>
  )
}

/** Staggers direct children of a grid/list into view. */
export function RevealGroup({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        Array.from(el.children),
        { opacity: 0, y: 28 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.08,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        }
      )
    })
    return () => ctx.revert()
  }, [reduced])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
