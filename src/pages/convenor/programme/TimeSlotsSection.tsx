import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../../lib/api'
import { fromKathmanduInputValue, formatKathmandu, toKathmanduInputValue } from '../../../lib/datetime'
import { copyDaySchema, scheduleSlotSchema } from '../../../lib/validation'
import { Alert, Button, ConfirmDialog, EmptyState, Input, SkeletonText } from '../../../components/ui'
import { EMPTY_SLOT_FORM, type ScheduleSlot } from './shared'

export function TimeSlotsSection({ conferenceId, onSlotsChanged }: { conferenceId: string; onSlotsChanged: () => void }) {
  const [slots, setSlots] = useState<ScheduleSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_SLOT_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copyFrom, setCopyFrom] = useState('')
  const [copyTo, setCopyTo] = useState('')
  const [copying, setCopying] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ slots: ScheduleSlot[] }>(`/conferences/${conferenceId}/schedule-slots`)
      setSlots(data.slots)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load time slots.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function resetForm() {
    setForm(EMPTY_SLOT_FORM)
    setEditingId(null)
  }

  function startEdit(slot: ScheduleSlot) {
    setEditingId(slot.id)
    setForm({
      label: slot.label,
      starts_at: toKathmanduInputValue(slot.starts_at),
      ends_at: toKathmanduInputValue(slot.ends_at),
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = scheduleSlotSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    const startsIso = fromKathmanduInputValue(parsed.data.starts_at)
    const endsIso = fromKathmanduInputValue(parsed.data.ends_at)
    if (!startsIso || !endsIso) {
      setError('Enter valid start and end times.')
      return
    }
    setSaving(true)
    const payload = { label: parsed.data.label, starts_at: startsIso, ends_at: endsIso }
    try {
      if (editingId) {
        await api.patch(`/conferences/${conferenceId}/schedule-slots/${editingId}`, payload)
      } else {
        await api.post(`/conferences/${conferenceId}/schedule-slots`, payload)
      }
      resetForm()
      await load()
      onSlotsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this time slot.')
    } finally {
      setSaving(false)
    }
  }

  const [confirmingDeleteSlot, setConfirmingDeleteSlot] = useState<ScheduleSlot | null>(null)

  async function handleDelete(slot: ScheduleSlot) {
    setConfirmingDeleteSlot(null)
    setBusyId(slot.id)
    try {
      await api.del(`/conferences/${conferenceId}/schedule-slots/${slot.id}`)
      if (editingId === slot.id) resetForm()
      await load()
      onSlotsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this time slot.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCopyDay(e: React.FormEvent) {
    e.preventDefault()
    setCopyMessage(null)
    const parsed = copyDaySchema.safeParse({ from_date: copyFrom, to_date: copyTo })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Choose both dates.')
      return
    }
    setCopying(true)
    setError(null)
    try {
      const result = await api.post<{ created: number }>(`/conferences/${conferenceId}/schedule-slots/copy-day`, {
        from_date: copyFrom,
        to_date: copyTo,
      })
      setCopyMessage(result.created === 0 ? 'No slots found on that day.' : `Copied ${result.created} slot(s).`)
      await load()
      onSlotsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not copy this day.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="mt-10">
      <h2 className="font-display text-xl font-semibold text-brand">Time slots</h2>
      <p className="mt-1 text-sm text-text-muted">
        Optional helpers (e.g. "Morning 1, 09:00–10:30") — pick one when creating a session to fill its start/end
        automatically.
      </p>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {loading ? (
        <SkeletonText lines={3} className="mt-3" />
      ) : slots.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No time slots yet." />
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {slots.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium text-text">{s.label}</span>{' '}
                <span className="text-text-muted">
                  {formatKathmandu(s.starts_at)} – {formatKathmandu(s.ends_at)}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="link" size="sm" onClick={() => startEdit(s)}>
                  Edit
                </Button>
                <Button type="button" variant="danger" size="sm" onClick={() => setConfirmingDeleteSlot(s)} disabled={busyId === s.id}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-surface p-4">
        <div>
          <label className="block text-xs font-medium text-text-muted">Label</label>
          <Input
            value={form.label}
            onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
            placeholder="Morning 1"
            className="mt-1 w-40"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted">Starts</label>
          <Input
            type="datetime-local"
            value={form.starts_at}
            onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted">Ends</label>
          <Input
            type="datetime-local"
            value={form.ends_at}
            onChange={(e) => setForm((p) => ({ ...p, ends_at: e.target.value }))}
            className="mt-1"
          />
        </div>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add slot'}
        </Button>
        {editingId ? (
          <Button type="button" variant="secondary" onClick={resetForm}>
            Cancel
          </Button>
        ) : null}
      </form>

      <form onSubmit={handleCopyDay} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-surface p-4">
        <div>
          <label className="block text-xs font-medium text-text-muted">Copy day from</label>
          <Input type="date" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted">To</label>
          <Input type="date" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} className="mt-1" />
        </div>
        <Button type="submit" variant="secondary" disabled={copying || !copyFrom || !copyTo}>
          {copying ? 'Copying…' : 'Copy day'}
        </Button>
        {copyMessage ? <span className="text-sm text-text-muted">{copyMessage}</span> : null}
      </form>

      <ConfirmDialog
        open={confirmingDeleteSlot !== null}
        title={`Delete "${confirmingDeleteSlot?.label ?? ''}"?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        busy={busyId === confirmingDeleteSlot?.id}
        onConfirm={() => confirmingDeleteSlot && handleDelete(confirmingDeleteSlot)}
        onCancel={() => setConfirmingDeleteSlot(null)}
      />
    </div>
  )
}
