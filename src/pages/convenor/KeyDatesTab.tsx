import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu, toKathmanduInputValue } from '../../lib/datetime'
import { buildKeyDatesPayload } from './keyDatesPayload'
import { useToast } from '../../components/ui/Toast'
import { toneBannerClasses } from '../../lib/status'
import { PageHeader, Card, FormField, Input, Checkbox, Button, Alert, Spinner } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'

type DeadlineRow = {
  code: string
  name: string
  is_window: boolean
  sort_order: number
  opens_at: string | null
  closes_at: string | null
  is_public: boolean | null
}

type RowState = {
  opens_at: string
  closes_at: string
  is_public: boolean
}

const EMPTY_ROW: RowState = { opens_at: '', closes_at: '', is_public: true }

export function KeyDatesTab({ conferenceId }: { conferenceId: string }) {
  const [deadlineRows, setDeadlineRows] = useState<DeadlineRow[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [conferenceDates, setConferenceDates] = useState<{ start_date: string; end_date: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Fields holding a half-typed date/time: the browser reports those as '' (see buildKeyDatesPayload).
  const [incomplete, setIncomplete] = useState<Set<string>>(new Set())
  const { showToast } = useToast()

  const load = useCallback(
    async (isCancelled: () => boolean = () => false, showSpinner = true) => {
      if (showSpinner) setLoading(true)
      try {
        // Independent - run together rather than one after the other.
        const [data, details] = await Promise.all([
          api.get<{ deadlines: DeadlineRow[] }>(`/conferences/${conferenceId}/deadlines`),
          api.get<{ conference: { start_date: string; end_date: string } }>(`/conferences/${conferenceId}/details`),
        ])
        if (isCancelled()) return

        setDeadlineRows(data.deadlines)
        setConferenceDates({ start_date: details.conference.start_date, end_date: details.conference.end_date })
        const nextRows: Record<string, RowState> = {}
        for (const d of data.deadlines) {
          nextRows[d.code] = d.opens_at
            ? {
                opens_at: toKathmanduInputValue(d.opens_at),
                closes_at: d.closes_at ? toKathmanduInputValue(d.closes_at) : '',
                is_public: d.is_public ?? true,
              }
            : { ...EMPTY_ROW }
        }
        setRows(nextRows)
        setIncomplete(new Set())
        setError(null)
      } catch (err) {
        if (isCancelled()) return
        setError(err instanceof ApiError ? err.message : 'Could not load key dates.')
      } finally {
        if (!isCancelled()) setLoading(false)
      }
    },
    [conferenceId],
  )

  useEffect(() => {
    let cancelled = false
    load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  /**
   * Catches the two mistakes that quietly break the event: abstract
   * submission still open once the conference has already started, or
   * registration still open after it's already ended. Compared as plain
   * date strings ('YYYY-MM-DD' vs the date part of the saved closes_at) -
   * good enough for a same-day warning without pulling in timezone math.
   */
  function closingWarning(code: string): string | null {
    if (!conferenceDates) return null
    const row = rows[code]
    if (!row?.closes_at) return null
    const closesDate = row.closes_at.slice(0, 10)
    if (code === 'abstract_submission' && closesDate > conferenceDates.start_date) {
      return `Abstract submission closes after the conference starts (${formatKathmandu(conferenceDates.start_date, { dateOnly: true })}) - authors may not be able to submit in time.`
    }
    if (code === 'registration' && closesDate > conferenceDates.end_date) {
      return `Registration closes after the conference ends (${formatKathmandu(conferenceDates.end_date, { dateOnly: true })}) - attendees could register for an event that's already over.`
    }
    return null
  }

  function update(code: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }))
  }

  /** onChange for a date/time field: remembers whether the browser is holding a half-typed value. */
  function updateDateField(code: string, field: 'opens_at' | 'closes_at', input: HTMLInputElement) {
    const key = `${code}.${field}`
    const isIncomplete = input.value === '' && input.validity.badInput
    setIncomplete((prev) => {
      if (prev.has(key) === isIncomplete) return prev
      const next = new Set(prev)
      if (isIncomplete) next.add(key)
      else next.delete(key)
      return next
    })
    update(code, { [field]: input.value })
  }

  async function handleSave() {
    setError(null)
    const built = buildKeyDatesPayload(deadlineRows, rows, incomplete)
    if ('error' in built) {
      setError(built.error)
      showToast(built.error, 'error')
      return
    }
    const payload = built.payload

    setSaving(true)
    try {
      await api.put(`/conferences/${conferenceId}/deadlines`, { deadlines: payload })
      showToast('Key dates saved.', 'success')
      // Show exactly what the server stored (and reset the form to it).
      await load(undefined, false)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save key dates.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="Key dates" subtitle="Times are shown and saved in Nepal time (Asia/Kathmandu)." />
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="space-y-4">
        {deadlineRows.map((t) => {
          const row = rows[t.code] ?? EMPTY_ROW
          return (
            <Card key={t.code} role="group" aria-label={t.name}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-text">{t.name}</p>
                <Checkbox
                  label="Show on public page"
                  checked={row.is_public}
                  onChange={(e) => update(t.code, { is_public: e.target.checked })}
                />
              </div>

              {t.is_window ? (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Opens">
                    <Input
                      type="datetime-local"
                      value={row.opens_at}
                      onChange={(e) => updateDateField(t.code, 'opens_at', e.currentTarget)}
                      onBlur={(e) => updateDateField(t.code, 'opens_at', e.currentTarget)}
                      error={incomplete.has(`${t.code}.opens_at`)}
                    />
                  </FormField>
                  <FormField label="Closes">
                    <Input
                      type="datetime-local"
                      value={row.closes_at}
                      onChange={(e) => updateDateField(t.code, 'closes_at', e.currentTarget)}
                      onBlur={(e) => updateDateField(t.code, 'closes_at', e.currentTarget)}
                      error={incomplete.has(`${t.code}.closes_at`)}
                    />
                  </FormField>
                </div>
              ) : (
                <div className="mt-3 max-w-xs">
                  <FormField label="Date">
                    <Input
                      type="datetime-local"
                      value={row.closes_at}
                      onChange={(e) => updateDateField(t.code, 'closes_at', e.currentTarget)}
                      onBlur={(e) => updateDateField(t.code, 'closes_at', e.currentTarget)}
                      error={incomplete.has(`${t.code}.closes_at`)}
                    />
                  </FormField>
                </div>
              )}

              {closingWarning(t.code) ? (
                <div className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${toneBannerClasses('warning')}`}>
                  <Icon icon={AlertTriangle} size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{closingWarning(t.code)}</span>
                </div>
              ) : null}
            </Card>
          )
        })}
      </div>

      <Button
        variant="primary"
        className="mt-6"
        onClick={handleSave}
        disabled={saving}
        loading={saving}
        iconLeft={<Icon icon={Save} size={16} />}
      >
        {saving ? 'Saving…' : 'Save key dates'}
      </Button>
    </div>
  )
}
