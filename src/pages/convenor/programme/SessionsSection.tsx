import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../../lib/api'
import { fromKathmanduInputValue, formatKathmandu, formatKathmanduTime, kathmanduDateKey, toKathmanduInputValue } from '../../../lib/datetime'
import { SESSION_STATUSES, SESSION_TYPES, sessionSchema, type SessionInput } from '../../../lib/validation'
import { Alert, Button, ConfirmDialog, EmptyState, Input, Select, SkeletonText, StatusChip, Tabs, Textarea } from '../../../components/ui'
import { EMPTY_SESSION_FORM, SESSION_TYPE_STYLES, findClashes, trackColor, type Room, type ScheduleSlot, type SessionRow, type Track } from './shared'
import { WarningsPanel } from './WarningsPanel'
import { SessionManagePanel } from './SessionManagePanel'

export function SessionsSection({
  conferenceId,
  roomsVersion,
  slotsVersion,
}: {
  conferenceId: string
  roomsVersion: number
  slotsVersion: number
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [slots, setSlots] = useState<ScheduleSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_SESSION_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [manageSessionId, setManageSessionId] = useState<string | null>(null)
  const [warningsKey, setWarningsKey] = useState(0)
  const [confirmingDeleteSession, setConfirmingDeleteSession] = useState<SessionRow | null>(null)
  const [activeDay, setActiveDay] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'grid'>('list')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sessionsData, roomsData, tracksData, slotsData] = await Promise.all([
        api.get<{ sessions: SessionRow[] }>(`/conferences/${conferenceId}/sessions`),
        api.get<{ rooms: Room[] }>(`/conferences/${conferenceId}/rooms`),
        api.get<{ tracks: Track[] }>(`/conferences/${conferenceId}/tracks`),
        api.get<{ slots: ScheduleSlot[] }>(`/conferences/${conferenceId}/schedule-slots`),
      ])
      setSessions(sessionsData.sessions)
      setRooms(roomsData.rooms.filter((r) => r.status === 'active'))
      setTracks(tracksData.tracks)
      setSlots(slotsData.slots)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load sessions.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load, roomsVersion, slotsVersion])

  const days = useMemo(() => {
    const keys = new Set(sessions.map((s) => kathmanduDateKey(s.starts_at)))
    return [...keys].sort()
  }, [sessions])

  useEffect(() => {
    if (activeDay && days.includes(activeDay)) return
    setActiveDay(days[0] ?? null)
  }, [days, activeDay])

  const visibleSessions = useMemo(
    () => (activeDay ? sessions.filter((s) => kathmanduDateKey(s.starts_at) === activeDay) : sessions),
    [sessions, activeDay],
  )

  function resetForm() {
    setForm(EMPTY_SESSION_FORM)
    setEditingId(null)
    setFormError(null)
  }

  function startEdit(session: SessionRow) {
    setEditingId(session.id)
    setForm({
      title: session.title,
      session_type: session.session_type,
      track_id: session.track_id ?? '',
      room_id: session.room_id,
      slot_id: session.slot_id ?? '',
      description: session.description ?? '',
      starts_at: toKathmanduInputValue(session.starts_at),
      ends_at: toKathmanduInputValue(session.ends_at),
      status: session.status,
    })
    setFormError(null)
  }

  function applySlot(slotId: string) {
    const slot = slots.find((s) => s.id === slotId)
    setForm((p) => ({
      ...p,
      slot_id: slotId,
      starts_at: slot ? toKathmanduInputValue(slot.starts_at) : p.starts_at,
      ends_at: slot ? toKathmanduInputValue(slot.ends_at) : p.ends_at,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = sessionSchema.safeParse(form as SessionInput)
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }

    const startsIso = fromKathmanduInputValue(parsed.data.starts_at)
    const endsIso = fromKathmanduInputValue(parsed.data.ends_at)
    if (!startsIso || !endsIso) {
      setFormError('Enter valid start and end times.')
      return
    }

    setSaving(true)
    const payload = {
      title: parsed.data.title,
      session_type: parsed.data.session_type,
      track_id: parsed.data.track_id || null,
      room_id: parsed.data.room_id,
      slot_id: form.slot_id || null,
      description: parsed.data.description || null,
      starts_at: startsIso,
      ends_at: endsIso,
      status: parsed.data.status,
    }

    try {
      if (editingId) {
        await api.patch(`/conferences/${conferenceId}/sessions/${editingId}`, payload)
      } else {
        await api.post(`/conferences/${conferenceId}/sessions`, payload)
      }
      resetForm()
      await load()
      setWarningsKey((k) => k + 1)
    } catch (err) {
      // Surface the database's own message (e.g. room overlap, outside conference dates) verbatim.
      setFormError(err instanceof ApiError ? err.message : 'Could not save this session.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(session: SessionRow) {
    setConfirmingDeleteSession(null)
    setBusyId(session.id)
    try {
      await api.del(`/conferences/${conferenceId}/sessions/${session.id}`)
      if (editingId === session.id) resetForm()
      await load()
      setWarningsKey((k) => k + 1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this session.')
    } finally {
      setBusyId(null)
    }
  }

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? '—'
  const trackName = (id: string | null) => (id ? tracks.find((t) => t.id === id)?.name ?? '—' : '—')
  const manageSession = sessions.find((s) => s.id === manageSessionId) ?? null
  const clashes = useMemo(() => findClashes(visibleSessions), [visibleSessions])
  const gridRows = useMemo(() => {
    const byStart = new Map<string, SessionRow[]>()
    for (const s of [...visibleSessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
      byStart.set(s.starts_at, [...(byStart.get(s.starts_at) ?? []), s])
    }
    return [...byStart.entries()]
  }, [visibleSessions])

  return (
    <div className="mt-10">
      <WarningsPanel conferenceId={conferenceId} refreshKey={warningsKey} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-brand">Sessions</h2>
          {clashes.size > 0 ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-danger">
              <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
              {clashes.size} sessions overlap in the same room
            </p>
          ) : null}
        </div>
        {/* Grid collapses to the list on narrow screens regardless of the toggle. */}
        <div className="hidden gap-1 rounded-lg border border-border-soft bg-surface p-1 shadow-card sm:flex">
          <Button type="button" variant={view === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('list')}>
            List
          </Button>
          <Button type="button" variant={view === 'grid' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('grid')}>
            Grid
          </Button>
        </div>
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {days.length > 1 ? (
        <Tabs
          className="mt-3"
          tabs={days.map((d) => ({ id: d, label: formatKathmandu(`${d}T00:00:00Z`, { dateOnly: true }) }))}
          active={activeDay ?? ''}
          onChange={(id) => setActiveDay(id)}
        />
      ) : null}

      {loading ? (
        <SkeletonText lines={4} className="mt-3" />
      ) : visibleSessions.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-surface">
          <EmptyState title="No sessions yet." message="Add rooms and a first session below to start building the programme." />
        </div>
      ) : view === 'grid' ? (
        <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border-soft bg-surface shadow-card sm:block">
          <table className="w-full min-w-[640px] table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-border-soft bg-surface-muted/60">
                <th className="w-24 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Time</th>
                {rooms.map((r) => (
                  <th key={r.id} className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {r.name}
                    {r.capacity ? <span className="ml-1 font-normal normal-case tracking-normal">· {r.capacity}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {gridRows.map(([startsAt, rowSessions]) => (
                <tr key={startsAt} className="align-top">
                  <td className="whitespace-nowrap px-3 py-3 font-medium tabular-nums text-text">{formatKathmanduTime(startsAt)}</td>
                  {rooms.map((r) => (
                    <td key={r.id} className="space-y-2 px-2 py-2">
                      {rowSessions
                        .filter((s) => s.room_id === r.id)
                        .map((s) => {
                          const style = SESSION_TYPE_STYLES[s.session_type] ?? SESSION_TYPE_STYLES.paper
                          const clash = clashes.has(s.id)
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setManageSessionId(s.id)}
                              className={`block w-full rounded-lg border border-l-4 bg-surface px-3 py-2 text-left shadow-card transition hover:-translate-y-px hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button ${style.rail} ${clash ? 'border-danger/60 ring-1 ring-danger/30' : 'border-border-soft'} ${s.status === 'cancelled' ? 'opacity-60' : ''}`}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${style.chip}`}>{s.session_type}</span>
                                {s.status !== 'published' ? <span className="text-[11px] capitalize text-text-muted">{s.status}</span> : null}
                              </span>
                              <span className={`mt-1.5 block text-sm font-medium leading-snug text-text ${s.status === 'cancelled' ? 'line-through' : ''}`}>{s.title}</span>
                              <span className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                                {s.track_id ? (
                                  <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: trackColor(s.track_id, tracks) }} aria-hidden="true" />
                                ) : null}
                                <span className="tabular-nums">
                                  {formatKathmanduTime(s.starts_at)}–{formatKathmanduTime(s.ends_at)}
                                </span>
                              </span>
                              {clash ? <span className="mt-1 block text-xs font-semibold text-danger">Room clash</span> : null}
                            </button>
                          )
                        })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {visibleSessions.length > 0 ? (
        <div className={`mt-4 overflow-x-auto rounded-xl border border-border-soft bg-surface shadow-card ${view === 'grid' ? 'sm:hidden' : ''}`}>
          <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-border-soft bg-surface-muted/60 text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-3 font-semibold">Title</th>
                  <th className="px-3 py-3 font-semibold">Type</th>
                  <th className="px-3 py-3 font-semibold">Track</th>
                  <th className="px-3 py-3 font-semibold">Room</th>
                  <th className="px-3 py-3 font-semibold">When</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {visibleSessions.map((s) => (
                  <tr key={s.id} className="transition-colors hover:bg-page-bg/60">
                    <td className="min-w-[10rem] px-3 py-3 font-medium text-text">{s.title}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold capitalize ${(SESSION_TYPE_STYLES[s.session_type] ?? SESSION_TYPE_STYLES.paper).chip}`}>
                        {s.session_type}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-2">
                        {s.track_id ? (
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: trackColor(s.track_id, tracks) }} aria-hidden="true" />
                        ) : null}
                        {trackName(s.track_id)}
                      </span>
                    </td>
                    <td className="px-3 py-3">{roomName(s.room_id)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {kathmanduDateKey(s.starts_at) === kathmanduDateKey(s.ends_at) ? (
                        <>
                          <span className="tabular-nums">
                            {formatKathmanduTime(s.starts_at)} – {formatKathmanduTime(s.ends_at)}
                          </span>
                          <span className="block text-xs text-text-muted">{formatKathmandu(s.starts_at, { dateOnly: true })}</span>
                        </>
                      ) : (
                        <>
                          {formatKathmandu(s.starts_at)} – {formatKathmandu(s.ends_at)}
                        </>
                      )}
                      {clashes.has(s.id) ? <span className="mt-0.5 block text-xs font-semibold text-danger">Room clash</span> : null}
                    </td>
                    <td className="px-3 py-3">
                      <StatusChip status={s.status} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setManageSessionId(s.id)}>
                          Manage
                        </Button>
                        <Button type="button" variant="ghost" size="sm" aria-label="Edit" title="Edit" onClick={() => startEdit(s)}>
                          <Pencil size={16} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Delete"
                          title="Delete"
                          className="text-danger hover:bg-danger/10"
                          onClick={() => setConfirmingDeleteSession(s)}
                          disabled={busyId === s.id}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-3 rounded-xl border border-border-soft bg-surface p-5 shadow-card">
        <p className="font-semibold text-text">{editingId ? 'Edit session' : 'Add a session'}</p>
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          placeholder="Title"
        />

        <Textarea
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          placeholder="Description (optional)"
          rows={2}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select
            value={form.session_type}
            onChange={(e) => setForm((p) => ({ ...p, session_type: e.target.value as (typeof SESSION_TYPES)[number] }))}
            className="capitalize"
          >
            {SESSION_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </Select>

          <Select value={form.track_id} onChange={(e) => setForm((p) => ({ ...p, track_id: e.target.value }))}>
            <option value="">No track</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>

          <Select value={form.room_id} onChange={(e) => setForm((p) => ({ ...p, room_id: e.target.value }))}>
            <option value="">Choose a room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>

          <Select
            value={form.status}
            onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as (typeof SESSION_STATUSES)[number] }))}
            className="capitalize"
          >
            {SESSION_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </Select>
        </div>

        {slots.length > 0 ? (
          <div>
            <label className="block text-xs font-medium text-text-muted">Time slot (optional — fills start/end below)</label>
            <Select value={form.slot_id} onChange={(e) => applySlot(e.target.value)} className="mt-1">
              <option value="">No slot — set times manually</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({formatKathmandu(s.starts_at)} – {formatKathmandu(s.ends_at)})
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-text-muted">Starts (Asia/Kathmandu)</label>
            <Input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted">Ends (Asia/Kathmandu)</label>
            <Input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm((p) => ({ ...p, ends_at: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add session'}
          </Button>
          {editingId ? (
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      {manageSession ? (
        <SessionManagePanel
          conferenceId={conferenceId}
          sessionId={manageSession.id}
          trackId={manageSession.track_id}
          onClose={() => setManageSessionId(null)}
          onChanged={() => setWarningsKey((k) => k + 1)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmingDeleteSession !== null}
        title={`Delete "${confirmingDeleteSession?.title ?? ''}"?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        busy={busyId === confirmingDeleteSession?.id}
        onConfirm={() => confirmingDeleteSession && handleDelete(confirmingDeleteSession)}
        onCancel={() => setConfirmingDeleteSession(null)}
      />
    </div>
  )
}
