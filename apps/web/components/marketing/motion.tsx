'use client'

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

/**
 * By product decision these entrance animations run for every visitor,
 * including those with reduced motion set: the owner wants the site to feel
 * alive on every machine. They are short, play once and never scroll-jack.
 * Content is rendered visible by default and GSAP only applies the hidden
 * start state when it runs, so nothing is lost if JavaScript fails.
 * Set ANIMATE_FOR_EVERYONE to false to honour the OS setting again.
 */
const ANIMATE_FOR_EVERYONE = true

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
    () => true // server snapshot: never animate during SSR/hydration
  )
}

/** True when the entrance animations below should be skipped. */
function useSkipMotion(): boolean {
  const reduced = useReducedMotion()
  return reduced && !ANIMATE_FOR_EVERYONE
}

const START = 'top 85%'

/** Fades and lifts its children into view as they enter the viewport. */
export function Reveal({
  children,
  delay = 0,
  y = 40,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const skip = useSkipMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || skip) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, y, filter: 'blur(6px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 1.1,
          delay,
          ease: 'power3.out',
          clearProps: 'filter',
          scrollTrigger: { trigger: el, start: START, once: true },
        }
      )
    })
    return () => ctx.revert()
  }, [delay, y, skip])

  return (
    <div ref={ref} data-motion className={className}>
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
  const skip = useSkipMotion()

  const format = (v: number) =>
    `${prefix}${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (skip) {
      el.textContent = format(to)
      return
    }

    const ctx = gsap.context(() => {
      const counter = { value: 0 }
      gsap.to(counter, {
        value: to,
        duration: 1.6,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: START, once: true },
        onUpdate: () => {
          el.textContent = format(counter.value)
        },
      })
    })
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, skip, prefix, suffix, decimals])

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
  const skip = useSkipMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || skip) return
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
  }, [strength, skip])

  return (
    <div ref={ref} className="inline-flex will-change-transform">
      {children}
    </div>
  )
}

/**
 * Reveals text word by word, each word rising from behind a clipped line
 * (masked, y 110% to 0). Splitting on words rather than characters keeps
 * the text readable to screen readers and search.
 */
export function RevealWords({
  text,
  className,
  stagger = 0.045,
}: {
  text: string
  className?: string
  stagger?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const skip = useSkipMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || skip) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el.querySelectorAll('[data-word] > span'),
        { yPercent: 110 },
        {
          yPercent: 0,
          duration: 1.1,
          stagger,
          ease: 'expo.out',
          scrollTrigger: { trigger: el, start: START, once: true },
        }
      )
    })
    return () => ctx.revert()
  }, [skip, stagger])

  const words = text.split(' ')
  return (
    <span ref={ref} data-motion className={className}>
      {words.map((word, i) => (
        // pb/-mb keeps descenders (g, p, y) from being clipped by the mask.
        <span key={`${word}-${i}`} data-word className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-bottom">
          <span className="inline-block">
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        </span>
      ))}
    </span>
  )
}

/** Staggers direct children of a grid/list into view. */
export function RevealGroup({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const skip = useSkipMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || skip) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        Array.from(el.children),
        { opacity: 0, y: 60, filter: 'blur(6px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 1.1,
          stagger: 0.1,
          ease: 'power3.out',
          clearProps: 'filter',
          scrollTrigger: { trigger: el, start: START, once: true },
        }
      )
    })
    return () => ctx.revert()
  }, [skip])

  return (
    <div ref={ref} data-motion className={className}>
      {children}
    </div>
  )
}

/**
 * Ruled list rows that build themselves as they scroll in. For each
 * `[data-row]`: its hairline `[data-rule]` draws left to right, then its
 * `[data-row-part]` children (index, title, description) rise ~60px from
 * below, fading and sharpening from a slight blur, one after another.
 * Each row triggers on its own, once, at 85% down the viewport.
 */
export function RevealRows({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const skip = useSkipMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || skip) return

    const ctx = gsap.context(() => {
      el.querySelectorAll<HTMLElement>('[data-row]').forEach((row) => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: row, start: START, once: true } })
        tl.fromTo(
          row.querySelectorAll('[data-rule]'),
          { scaleX: 0, transformOrigin: '0% 50%' },
          { scaleX: 1, duration: 1.2, ease: 'expo.out' }
        )
        tl.fromTo(
          row.querySelectorAll('[data-row-part]'),
          { y: 60, opacity: 0, filter: 'blur(8px)' },
          {
            y: 0,
            opacity: 1,
            filter: 'blur(0px)',
            duration: 1.1,
            stagger: 0.1,
            ease: 'power3.out',
            clearProps: 'filter',
          },
          0.12
        )
      })
    })
    return () => ctx.revert()
  }, [skip])

  return (
    <div ref={ref} data-motion className={className}>
      {children}
    </div>
  )
}

/**
 * Site-wide scroll-in for text and cards that no explicit Reveal wrapper
 * already handles. Mounted once in the root layout; on every route it finds
 * top-level text/card blocks (and ones added later, e.g. after a fetch) and
 * lifts each into view once, at 85% down the viewport. App screens get a
 * shorter, smaller motion than the landing page. Elements are only hidden
 * by GSAP while it runs, and reverting on route change restores them.
 */
const AUTO_SELECTOR =
  'h1,h2,h3,h4,p,li,hr,dl,table,form,[data-slot="card"],[data-slot="card-content"]'
const AUTO_SKIP = '[data-motion],[data-sonner-toaster],[aria-hidden="true"],nav,header'

export function AutoReveal({ pathname }: { pathname: string }) {
  const skip = useSkipMotion()

  useEffect(() => {
    if (skip) return
    const landing = pathname === '/'
    const y = landing ? 50 : 18
    const duration = landing ? 1 : 0.55
    const seen = new WeakSet<Element>()

    const ctx = gsap.context(() => {})
    const scan = () => {
      const fresh: HTMLElement[] = []
      document.body.querySelectorAll<HTMLElement>(AUTO_SELECTOR).forEach((el) => {
        if (seen.has(el)) return
        if (el.closest(AUTO_SKIP)) return
        if (el.parentElement?.closest(AUTO_SELECTOR)) return // animate the outer block only
        seen.add(el)
        fresh.push(el)
      })
      if (!fresh.length) return
      ctx.add(() => {
        ScrollTrigger.batch(fresh, {
          start: START,
          once: true,
          onEnter: (batch) =>
            gsap.fromTo(
              batch,
              { opacity: 0, y, filter: landing ? 'blur(6px)' : 'blur(0px)' },
              {
                opacity: 1,
                y: 0,
                filter: 'blur(0px)',
                duration,
                stagger: landing ? 0.1 : 0.05,
                ease: 'power3.out',
                clearProps: 'all',
              }
            ),
        })
      })
    }

    // Let the new route paint first, then watch for content that arrives later.
    const first = window.setTimeout(scan, 60)
    let queued = 0
    const observer = new MutationObserver(() => {
      window.clearTimeout(queued)
      queued = window.setTimeout(scan, 80)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      window.clearTimeout(first)
      window.clearTimeout(queued)
      observer.disconnect()
      ctx.revert()
    }
  }, [pathname, skip])

  return null
}
