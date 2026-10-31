import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { publicImageUrl } from '../../lib/storage'
import { resolveConferenceBrand } from '../../lib/color'
import { Button, Input, Skeleton } from '../ui'

type PublicConferenceRow = {
  id: string
  slug: string
  code: string | null
  name: string | null
  short_name: string | null
  start_date: string | null
  city: string | null
  country: string | null
  logo_path: string | null
  primary_color: string | null
}

function ConferenceLogo({ row }: { row: PublicConferenceRow }) {
  const [failed, setFailed] = useState(false)
  const url = failed ? null : publicImageUrl(row.logo_path)
  const brand = resolveConferenceBrand(row.primary_color)
  if (url) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setFailed(true)}
        className="h-11 w-11 flex-shrink-0 rounded-xl border border-border-soft bg-white object-contain p-1"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl font-display text-lg font-semibold"
      style={{ backgroundColor: brand.color, color: brand.onColor }}
    >
      {(row.name ?? row.slug).trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function subline(row: PublicConferenceRow): string {
  const parts: string[] = []
  if (row.start_date) {
    const d = new Date(row.start_date)
    if (!Number.isNaN(d.getTime())) parts.push(d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }))
  }
  const place = [row.city, row.country].filter(Boolean).join(', ')
  if (place) parts.push(place)
  return parts.join(' · ')
}

/**
 * "Choose your conference" (the generic /login and /signup): every account
 * page belongs to one conference, so the visitor picks it first.
 */
export function ConferenceChooser({ target }: { target: 'login' | 'signup' }) {
  const [rows, setRows] = useState<PublicConferenceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setRows(null)
    api
      .get<{ conferences: PublicConferenceRow[] }>('/conferences/public')
      .then((data) => {
        if (cancelled) return
        setRows((data?.conferences ?? []).slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Can't reach the server. Check your connection.")
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => [r.name, r.short_name, r.code, r.city, r.country, r.slug].some((v) => v?.toLowerCase().includes(q)))
  }, [rows, query])

  return (
    <div>
      <label htmlFor="conference-search" className="sr-only">
        Search conferences
      </label>
      <div className="relative">
        <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-muted" />
        <Input
          id="conference-search"
          type="search"
          placeholder="Search by name, code or city"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10"
          autoComplete="off"
        />
      </div>

      <div className="mt-4" aria-live="polite">
        {error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-5 text-center text-sm">
            <p className="text-danger" role="alert">
              {error}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : rows === null ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-[68px] w-full rounded-xl" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-page-bg px-4 py-6 text-center text-sm text-text-muted">
            No conference is open on this platform yet. Check back once one has been published.
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-page-bg px-4 py-6 text-center text-sm text-text-muted">
            No conference matches &ldquo;{query.trim()}&rdquo;.
          </div>
        ) : (
          <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-0.5">
            {filtered.map((row) => {
              const meta = subline(row)
              return (
                <li key={row.id}>
                  <Link
                    to={`/c/${encodeURIComponent(row.slug)}/${target}`}
                    className="group flex items-center gap-3 rounded-xl border border-border-soft bg-surface px-3 py-3 transition-colors hover:border-button/50 hover:bg-page-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button"
                  >
                    <ConferenceLogo row={row} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text">
                        {row.name ?? row.slug}
                        {row.code ? <span className="font-normal text-text-muted"> ({row.code})</span> : null}
                      </span>
                      {meta ? <span className="block truncate text-sm text-text-muted">{meta}</span> : null}
                    </span>
                    <ChevronRight
                      size={18}
                      aria-hidden="true"
                      className="flex-shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
