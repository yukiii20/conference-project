import { useEffect, useState } from 'react'
import { AlertTriangle, Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { fromKathmanduInputValue, formatKathmandu, toKathmanduInputValue } from '../../lib/datetime'
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
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // Independent - run together rather than one after the other.
        const [data, details] = await Promise.all([
          api.get<{ deadlines: DeadlineRow[] }>(`/conferences/${conferenceId}/deadlines`),
          api.get<{ conference: { start_date: string; end_date: string } }>(`/conferences/${conferenceId}/details`),
        ])
        if (cancelled) return

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
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load key dates.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

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

  async function handleSave() {
    setError(null)

    const payload: Array<{
      deadline_type: string
      opens_at: string
      closes_at: string | null
      is_public: boolean
    }> = []

    for (const t of deadlineRows) {
      const row = rows[t.code]
      if (!row) continue

      if (t.is_window) {
        if (!row.opens_at) continue // not set yet — leave it alone
        const opensIso = fromKathmanduInputValue(row.opens_at)
        const closesIso = row.closes_at ? fromKathmanduInputValue(row.closes_at) : null
        if (!opensIso) continue
        if (closesIso && closesIso < opensIso) {
          setError(`${t.name}: the closing date must be on or after the opening date.`)
          return
        }
        payload.push({ deadline_type: t.code, opens_at: opensIso, closes_at: closesIso, is_public: row.is_public })
      } else {
        if (!row.closes_at) continue
        const iso = fromKathmanduInputValue(row.closes_at)
        if (!iso) continue
        payload.push({ deadline_type: t.code, opens_at: iso, closes_at: iso, is_public: row.is_public })
      }
    }

    if (payload.length === 0) {
      setError('Set at least one date before saving.')
      return
    }

    setSaving(true)
    try {
      await api.put(`/conferences/${conferenceId}/deadlines`, { deadlines: payload })
      showToast('Saved.', 'success')
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
            <Card key={t.code}>
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
                      onChange={(e) => update(t.code, { opens_at: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Closes">
                    <Input
                      type="datetime-local"
                      value={row.closes_at}
                      onChange={(e) => update(t.code, { closes_at: e.target.value })}
                    />
                  </FormField>
                </div>
              ) : (
                <div className="mt-3 max-w-xs">
                  <FormField label="Date">
                    <Input
                      type="datetime-local"
                      value={row.closes_at}
                      onChange={(e) => update(t.code, { closes_at: e.target.value })}
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
