import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { formatMoney } from '../../lib/money'
import { Alert, Skeleton } from '../ui'

export type PublicCategory = {
  id: string
  name: string
  description: string | null
  current_fee: { amount: number; currency: string; valid_until: string } | null
  priced: boolean
}

type Options = { open: boolean; opens_at: string | null; closes_at: string | null; categories: PublicCategory[] }

function priceLabel(c: PublicCategory): string {
  if (c.current_fee && c.current_fee.amount > 0) return formatMoney(c.current_fee.amount, c.current_fee.currency)
  if (c.priced && !c.current_fee) return 'Not on sale now'
  return 'Free'
}

/**
 * "Choose a registration category" for the Audience sign-up. Reads the public options
 * (registration window from Key dates + active categories with today's price), so it works
 * before the person has an account. Reports whether registration is possible via `onAvailability`.
 */
export function AudienceCategoryPicker({
  conferenceId,
  value,
  onChange,
  error,
  onAvailability,
}: {
  conferenceId: string
  value: string
  onChange: (categoryId: string) => void
  error?: string
  onAvailability?: (canRegister: boolean) => void
}) {
  const [options, setOptions] = useState<Options | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setOptions(null)
    setLoadError(null)
    api
      .get<Options>(`/conferences/${conferenceId}/registration-categories/public`)
      .then((data) => {
        if (cancelled) return
        setOptions(data)
        const sellable = data.categories.filter((c) => !(c.priced && !c.current_fee))
        onAvailability?.(data.open && sellable.length > 0)
        if (sellable.length === 1 && !value) onChange(sellable[0]!.id)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the registration categories.')
        onAvailability?.(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenceId])

  if (loadError) return <Alert variant="danger">{loadError}</Alert>
  if (!options) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading registration categories">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (!options.open) {
    const opensLater = options.opens_at && new Date(options.opens_at).getTime() > Date.now()
    return (
      <Alert variant="warning">
        {opensLater
          ? `Registration opens ${formatKathmandu(options.opens_at)}. You can sign up as Audience from then.`
          : options.opens_at
            ? 'Registration for this conference has closed.'
            : 'Registration for this conference is not open yet.'}
      </Alert>
    )
  }
  if (options.categories.length === 0) {
    return <Alert variant="warning">The organisers have not opened any registration category yet.</Alert>
  }

  return (
    <fieldset>
      <legend className="text-sm font-medium text-text">Registration category</legend>
      {options.closes_at ? <p className="mt-0.5 text-xs text-text-muted">Registration closes {formatKathmandu(options.closes_at)}.</p> : null}
      {error ? (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 space-y-2">
        {options.categories.map((c) => {
          const unavailable = c.priced && !c.current_fee
          return (
            <label
              key={c.id}
              className={`flex min-h-12 items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                unavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              } ${value === c.id ? 'border-button bg-indigo-soft ring-2 ring-button/30' : 'border-border bg-surface'}`}
            >
              <input
                type="radio"
                name="registration_category"
                value={c.id}
                checked={value === c.id}
                disabled={unavailable}
                onChange={() => onChange(c.id)}
                className="mt-0.5 accent-[var(--color-button)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium text-text">{c.name}</span>
                  <span className="text-text-muted">{priceLabel(c)}</span>
                </span>
                {c.description ? <span className="mt-0.5 block text-xs text-text-muted">{c.description}</span> : null}
              </span>
            </label>
          )
        })}
      </div>
      {(() => {
        const chosen = options.categories.find((c) => c.id === value)
        if (!chosen?.current_fee || chosen.current_fee.amount === 0) return null
        return (
          <p className="mt-2 text-xs text-text-muted">
            You get your ticket at once. The organisers confirm it when your payment of{' '}
            {formatMoney(chosen.current_fee.amount, chosen.current_fee.currency)} is received.
          </p>
        )
      })()}
    </fieldset>
  )
}
