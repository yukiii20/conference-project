import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True once the element has scrolled into view (and stays true). Always true under reduced motion. */
export function useInView<T extends Element>(rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0, rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  return [ref, inView] as const
}

const HIDDEN: Record<'up' | 'fade' | 'image', string> = {
  up: 'translate-y-5 opacity-0',
  fade: 'opacity-0',
  image: 'scale-[1.04] opacity-0 [clip-path:inset(6%_6%_6%_6%_round_24px)]',
}

/**
 * Reveals its children the first time they scroll into view. `up` fades and rises, `fade` only fades,
 * `image` unmasks from a slightly inset clip. Transform/opacity only, so nothing shifts layout.
 * Triggers once any part is 10% up the viewport, so a section taller than a phone screen still reveals.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = 'up',
  style,
}: {
  children: ReactNode
  className?: string
  delay?: number
  variant?: 'up' | 'fade' | 'image'
  style?: CSSProperties
}) {
  const [ref, visible] = useInView<HTMLDivElement>()
  const duration = variant === 'image' ? 'duration-[1200ms]' : 'duration-700'
  return (
    <div
      ref={ref}
      style={{ ...style, ...(delay ? { transitionDelay: `${delay}ms` } : null) }}
      className={`transition-all ${duration} ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
        visible ? 'translate-y-0 scale-100 opacity-100 [clip-path:inset(0_0_0_0_round_0px)]' : HIDDEN[variant]
      } ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

/** Counts from 0 to `value` once it scrolls into view (ease-out, ~1.2s). Renders the final value under reduced motion. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>('0px')
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!inView) return
    if (prefersReducedMotion() || value <= 0) {
      setShown(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const duration = 1200
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, value])

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ''}`}>
      {shown.toLocaleString()}
    </span>
  )
}
