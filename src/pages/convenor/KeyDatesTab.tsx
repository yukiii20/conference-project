import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { fromKathmanduInputValue, toKathmanduInputValue } from '../../lib/datetime'

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const data = await api.get<{ deadlines: DeadlineRow[] }>(`/conferences/${conferenceId}/deadlines`)
        if (cancelled) return

        setDeadlineRows(data.deadlines)
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

  function update(code: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }))
    setSaved(false)
  }

  async function handleSave() {
    setError(null)
    setSaved(false)

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
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save key dates.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  return (
    <div className="mt-6 max-w-3xl">
      {error ? (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div>
      ) : null}

      <p className="mb-4 text-sm text-ink/60">Times are shown and saved in Asia/Kathmandu time.</p>

      <div className="space-y-4">
        {deadlineRows.map((t) => {
          const row = rows[t.code] ?? EMPTY_ROW
          return (
            <div key={t.code} className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink">{t.name}</p>
                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input
                    type="checkbox"
                    checked={row.is_public}
                    onChange={(e) => update(t.code, { is_public: e.target.checked })}
                  />
                  Show on public page
                </label>
              </div>

              {t.is_window ? (
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-ink/60">Opens</label>
                    <input
                      type="datetime-local"
                      value={row.opens_at}
                      onChange={(e) => update(t.code, { opens_at: e.target.value })}
                      className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink/60">Closes</label>
                    <input
                      type="datetime-local"
                      value={row.closes_at}
                      onChange={(e) => update(t.code, { closes_at: e.target.value })}
                      className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-ink/60">Date</label>
                  <input
                    type="datetime-local"
                    value={row.closes_at}
                    onChange={(e) => update(t.code, { closes_at: e.target.value })}
                    className="mt-1 w-full max-w-xs rounded-md border border-line px-3 py-2 focus:border-button"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-6 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save key dates'}
      </button>
    </div>
  )
}
