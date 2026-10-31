import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'

/** Counts up to `value` once on mount (~600ms, ease-out). Static under prefers-reduced-motion. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let frame = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 600)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(from + (value - from) * eased))
      if (p < 1) frame = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return <span className={`tabular-nums ${className ?? ''}`}>{shown.toLocaleString('en-US')}</span>
}

/** KPI tile: label, big number, icon chip, optional hint line; a link when `to` is given. */
export function StatCard({
  label,
  value,
  icon,
  to,
  hint,
}: {
  label: string
  value: number | string
  icon: LucideIcon
  to?: string
  hint?: ReactNode
}) {
  const content = (
    <div className="flex h-full flex-col rounded-xl border border-border-soft bg-surface p-5 shadow-card transition-[box-shadow,border-color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-border group-hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-text-muted">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-soft text-button">
          <Icon icon={icon} size={18} />
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-brand">
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </p>
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  )
  if (!to) return content
  return (
    <Link to={to} className="group block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button">
      {content}
    </Link>
  )
}

/** Titled panel used across dashboards (white card, small-caps heading, optional right-hand action). */
export function Panel({ title, action, children, className = '' }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border-soft bg-surface p-5 shadow-card sm:p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}
