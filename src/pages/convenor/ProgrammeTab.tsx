import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { SessionTimerFields, TimerDefaultsSection } from './SessionTimerSettings'
import {
  fromKathmanduDateInputValue,
  fromKathmanduInputValue,
  formatKathmandu,
  formatKathmanduTime,
  kathmanduDateKey,
  toKathmanduDateInputValue,
  toKathmanduInputValue,
} from '../../lib/datetime'
import {
  copyDaySchema,
  ROOM_EQUIPMENT,
  ROOM_EQUIPMENT_LABELS,
  roomSchema,
  scheduleSlotSchema,
  SESSION_STATUSES,
  SESSION_TYPES,
  sessionSchema,
  type SessionInput,
} from '../../lib/validation'
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
  SkeletonText,
  StatusChip,
  Tabs,
  Textarea,
} from '../../components/ui'

const TRACK_COLORS = ['#DCEEFB', '#FDE7D8', '#E3F2DF', '#F3E3F5', '#FFF4CC', '#E2E8F0'] as const

function trackColor(trackId: string | null, tracks: Track[]): string {
  if (!trackId) return '#F3F4F6'
  const index = tracks.findIndex((t) => t.id === trackId)
  return TRACK_COLORS[index % TRACK_COLORS.length] ?? '#F3F4F6'
}

type Room = {
  id: string
  name: string
  room_number: string | null
  building: string | null
  floor: string | null
  capacity: number | null
  equipment: string[]
  description: string | null
  status: 'active' | 'inactive'
}

type Track = { id: string; name: string }

type ScheduleSlot = { id: string; label: string; starts_at: string; ends_at: string }

type SessionRow = {
  id: string
  title: string
  session_type: (typeof SESSION_TYPES)[number]
  description: string | null
  track_id: string | null
  room_id: string
  slot_id: string | null
  starts_at: string
  ends_at: string
  status: (typeof SESSION_STATUSES)[number]
}

type ChairInfo = { user_id: string; full_name: string; chair_role: 'chair' | 'co_chair' }
type PresentationInfo = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  presentation_order: number
  submission_code: string | null
  authors: string[] | null
  speaker_name: string | null
}
type SessionDetail = {
  id: string
  title: string
  chairs: ChairInfo[]
  presentations: PresentationInfo[]
}

type SchedulableSubmission = { id: string; submission_code: string | null; title: string; track_id: string }
type Speaker = { id: string; full_name: string }
type ChairCandidate = { user_id: string; full_name: string }

type Warnings = {
  unscheduled_papers: Array<{ id: string; title: string; submission_code: string | null }>
  sessions_without_chair: Array<{ id: string; title: string; starts_at: string }>
}

const EMPTY_ROOM = { name: '', room_number: '', building: '', floor: '', capacity: '', equipment: [] as string[], description: '' }

const EMPTY_SESSION_FORM = {
  title: '',
  session_type: 'paper' as (typeof SESSION_TYPES)[number],
  track_id: '',
  room_id: '',
  slot_id: '',
  description: '',
  starts_at: '',
  ends_at: '',
  status: 'draft' as (typeof SESSION_STATUSES)[number],
}

const EMPTY_SLOT_FORM = { label: '', starts_at: '', ends_at: '' }

/** Left-rail + chip colours per session type, so the grid reads at a glance. */
const SESSION_TYPE_STYLES: Record<(typeof SESSION_TYPES)[number], { rail: string; chip: string }> = {
  paper: { rail: 'border-l-indigo', chip: 'bg-indigo-soft text-button' },
  keynote: { rail: 'border-l-gold', chip: 'bg-gold-soft text-gold-ink' },
  panel: { rail: 'border-l-emerald-500', chip: 'bg-emerald-50 text-emerald-800' },
  workshop: { rail: 'border-l-sky-500', chip: 'bg-sky-50 text-sky-800' },
  poster: { rail: 'border-l-violet-500', chip: 'bg-violet-50 text-violet-800' },
  opening: { rail: 'border-l-brand', chip: 'bg-brand/10 text-brand' },
  closing: { rail: 'border-l-brand', chip: 'bg-brand/10 text-brand' },
  break: { rail: 'border-l-border-strong', chip: 'bg-surface-muted text-text-muted' },
}

/** Ids of non-cancelled sessions that overlap another session in the same room. */
function findClashes(sessions: SessionRow[]): Set<string> {
  const clashes = new Set<string>()
  const live = sessions.filter((s) => s.status !== 'cancelled')
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (a.room_id === b.room_id && a.starts_at < b.ends_at && b.starts_at < a.ends_at) {
        clashes.add(a.id)
        clashes.add(b.id)
      }
    }
  }
  return clashes
}

function WarningsPanel({ conferenceId, refreshKey }: { conferenceId: string; refreshKey: number }) {
  const [warnings, setWarnings] = useState<Warnings | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<Warnings>(`/conferences/${conferenceId}/sessions/warnings`)
      .then((data) => {
        if (!cancelled) setWarnings(data)
      })
      .catch(() => {
        if (!cancelled) setWarnings(null)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId, refreshKey])

  if (!warnings) return null
  const total = warnings.unscheduled_papers.length + warnings.sessions_without_chair.length
  if (total === 0) return null

  return (
    <div className="mb-6">
      <Alert variant="warning">
        <p className="font-medium">Needs attention</p>
        {warnings.unscheduled_papers.length > 0 ? (
          <p className="mt-1">
            {warnings.unscheduled_papers.length} accepted paper{warnings.unscheduled_papers.length === 1 ? '' : 's'} not
            yet scheduled: {warnings.unscheduled_papers.map((p) => p.title).join(', ')}
          </p>
        ) : null}
        {warnings.sessions_without_chair.length > 0 ? (
          <p className="mt-1">
            {warnings.sessions_without_chair.length} published session{warnings.sessions_without_chair.length === 1 ? '' : 's'} with
            no chair: {warnings.sessions_without_chair.map((s) => s.title).join(', ')}
          </p>
        ) : null}
      </Alert>
    </div>
  )
}

function RoomsSection({ conferenceId, onRoomsChanged }: { conferenceId: string; onRoomsChanged: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newRoom, setNewRoom] = useState(EMPTY_ROOM)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ rooms: Room[] }>(`/conferences/${conferenceId}/rooms`)
      setRooms(data.rooms)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load rooms.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function toggleEquipment(item: string) {
    setNewRoom((p) => ({
      ...p,
      equipment: p.equipment.includes(item) ? p.equipment.filter((e) => e !== item) : [...p.equipment, item],
    }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = roomSchema.safeParse(newRoom)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setCreating(true)
    try {
      await api.post(`/conferences/${conferenceId}/rooms`, parsed.data)
      setNewRoom(EMPTY_ROOM)
      await load()
      onRoomsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this room.')
    } finally {
      setCreating(false)
    }
  }

  async function handleToggle(room: Room) {
    setBusyId(room.id)
    setError(null)
    try {
      await api.patch(`/conferences/${conferenceId}/rooms/${room.id}/status`, {
        status: room.status === 'active' ? 'inactive' : 'active',
      })
      await load()
      onRoomsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this room.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-brand">Rooms</h2>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {loading ? (
        <SkeletonText lines={3} className="mt-3" />
      ) : rooms.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No rooms yet." />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-muted">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Building / floor</th>
                <th className="px-4 py-2 font-medium">Capacity</th>
                <th className="px-4 py-2 font-medium">Equipment</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    {r.name}
                    {r.room_number ? <span className="text-text-muted"> ({r.room_number})</span> : null}
                  </td>
                  <td className="px-4 py-2">{[r.building, r.floor].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-2">{r.capacity ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-text/70">
                    {r.equipment.length > 0
                      ? r.equipment.map((e) => ROOM_EQUIPMENT_LABELS[e as keyof typeof ROOM_EQUIPMENT_LABELS] ?? e).join(', ')
                      : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-4 py-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => handleToggle(r)} disabled={busyId === r.id}>
                      {r.status === 'active' ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded-lg border border-dashed border-border bg-surface p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-text-muted">Name</label>
            <Input
              value={newRoom.name}
              onChange={(e) => setNewRoom((p) => ({ ...p, name: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted">Room number</label>
            <Input
              value={newRoom.room_number}
              onChange={(e) => setNewRoom((p) => ({ ...p, room_number: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted">Building</label>
            <Input
              value={newRoom.building}
              onChange={(e) => setNewRoom((p) => ({ ...p, building: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted">Floor</label>
            <Input
              value={newRoom.floor}
              onChange={(e) => setNewRoom((p) => ({ ...p, floor: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-text-muted">Capacity</label>
            <Input
              type="number"
              min={1}
              value={newRoom.capacity}
              onChange={(e) => setNewRoom((p) => ({ ...p, capacity: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div className="col-span-2 sm:col-span-3">
            <label className="block text-xs font-medium text-text-muted">Description</label>
            <Input
              value={newRoom.description}
              onChange={(e) => setNewRoom((p) => ({ ...p, description: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-text-muted">Equipment</p>
          <div className="mt-1 flex flex-wrap gap-3">
            {ROOM_EQUIPMENT.map((item) => (
              <Checkbox
                key={item}
                label={ROOM_EQUIPMENT_LABELS[item]}
                checked={newRoom.equipment.includes(item)}
                onChange={() => toggleEquipment(item)}
              />
            ))}
          </div>
        </div>
        <Button type="submit" variant="primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add room'}
        </Button>
      </form>
    </div>
  )
}

function TimeSlotsSection({ conferenceId, onSlotsChanged }: { conferenceId: string; onSlotsChanged: () => void }) {
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

function SessionManagePanel({
  conferenceId,
  sessionId,
  trackId,
  onClose,
  onChanged,
}: {
  conferenceId: string
  sessionId: string
  trackId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [candidates, setCandidates] = useState<ChairCandidate[]>([])
  const [submissions, setSubmissions] = useState<SchedulableSubmission[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [chairUserId, setChairUserId] = useState('')
  const [chairRole, setChairRole] = useState<'chair' | 'co_chair'>('chair')
  const [paperId, setPaperId] = useState('')
  const [paperMinutes, setPaperMinutes] = useState('15')
  const [speakerId, setSpeakerId] = useState('')
  const [speakerTitle, setSpeakerTitle] = useState('')
  const [speakerMinutes, setSpeakerMinutes] = useState('15')

  const load = useCallback(async () => {
    try {
      const [detailData, candidatesData, submissionsData, speakersData] = await Promise.all([
        api.get<{ session: SessionDetail }>(`/conferences/${conferenceId}/sessions/${sessionId}`),
        api.get<{ candidates: ChairCandidate[] }>(`/conferences/${conferenceId}/sessions/chair-candidates`),
        api.get<{ submissions: SchedulableSubmission[] }>(
          `/conferences/${conferenceId}/sessions/schedulable-submissions`,
          trackId ? { track: trackId } : undefined,
        ),
        api.get<{ speakers: Speaker[] }>(`/conferences/${conferenceId}/speakers`),
      ])
      setDetail(detailData.session)
      setCandidates(candidatesData.candidates)
      setSubmissions(submissionsData.submissions)
      setSpeakers(speakersData.speakers)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this session.')
    }
  }, [conferenceId, sessionId, trackId])

  useEffect(() => {
    load()
  }, [load])

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete this action.')
    } finally {
      setBusy(false)
    }
  }

  async function addChair() {
    if (!chairUserId) return
    await withBusy(async () => {
      await api.post(`/conferences/${conferenceId}/sessions/${sessionId}/chairs`, {
        user_id: chairUserId,
        chair_role: chairRole,
      })
      setChairUserId('')
    })
  }

  async function removeChair(userId: string) {
    await withBusy(async () => {
      await api.del(`/conferences/${conferenceId}/sessions/${sessionId}/chairs/${userId}`)
    })
  }

  async function addPaper() {
    if (!paperId) return
    await withBusy(async () => {
      await api.post(`/conferences/${conferenceId}/sessions/${sessionId}/presentations/papers`, {
        submission_id: paperId,
        duration_minutes: Number(paperMinutes) || 15,
      })
      setPaperId('')
    })
  }

  async function addSpeakerTalk() {
    if (!speakerId || !speakerTitle.trim()) return
    await withBusy(async () => {
      await api.post(`/conferences/${conferenceId}/sessions/${sessionId}/presentations/speakers`, {
        speaker_id: speakerId,
        title: speakerTitle.trim(),
        duration_minutes: Number(speakerMinutes) || 15,
      })
      setSpeakerId('')
      setSpeakerTitle('')
    })
  }

  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null)

  async function removePresentation(id: string) {
    setConfirmingRemoveId(null)
    await withBusy(async () => {
      await api.del(`/conferences/${conferenceId}/sessions/${sessionId}/presentations/${id}`)
    })
  }

  async function move(index: number, direction: -1 | 1) {
    if (!detail) return
    const ids = detail.presentations.map((p) => p.id)
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    const next = [...ids]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    await withBusy(async () => {
      await api.post(`/conferences/${conferenceId}/sessions/${sessionId}/presentations/reorder`, {
        presentation_ids: next,
      })
    })
  }

  async function mark(id: string, status: 'presented' | 'absent') {
    await withBusy(async () => {
      await api.patch(`/conferences/${conferenceId}/sessions/${sessionId}/presentations/${id}/mark`, { status })
    })
  }

  return (
    <Modal open={true} onClose={onClose} size="lg">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">{detail?.title ?? 'Session'}</h3>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="mt-5">
        <p className="text-sm font-medium text-text">Chairs</p>
        {detail && detail.chairs.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {detail.chairs.map((c) => (
              <li key={c.user_id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                <span>
                  {c.full_name} <span className="text-text-muted">({c.chair_role === 'chair' ? 'Chair' : 'Co-chair'})</span>
                </span>
                <Button type="button" variant="danger" size="sm" onClick={() => removeChair(c.user_id)} disabled={busy}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-text-muted">No chairs assigned yet.</p>
        )}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select value={chairUserId} onChange={(e) => setChairUserId(e.target.value)} className="w-auto">
            <option value="">Choose a person</option>
            {candidates.map((c) => (
              <option key={c.user_id} value={c.user_id}>
                {c.full_name}
              </option>
            ))}
          </Select>
          <Select value={chairRole} onChange={(e) => setChairRole(e.target.value as 'chair' | 'co_chair')} className="w-auto">
            <option value="chair">Chair</option>
            <option value="co_chair">Co-chair</option>
          </Select>
          <Button type="button" variant="secondary" size="sm" onClick={addChair} disabled={busy || !chairUserId}>
            Add chair
          </Button>
        </div>
        {candidates.length === 0 ? (
          <p className="mt-1 text-xs text-text-muted">
            No one holds the session chair role yet — add it from People &gt; Members and roles.
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-text">Papers and talks</p>
        {detail && detail.presentations.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {detail.presentations.map((p, i) => (
              <li key={p.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text">{p.title}</p>
                    <p className="text-xs text-text-muted">
                      {formatKathmandu(p.starts_at)} – {formatKathmandu(p.ends_at)}
                      {p.authors ? ` · ${p.authors.join(', ')}` : p.speaker_name ? ` · ${p.speaker_name}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={busy || i === 0}>
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => move(i, 1)}
                      disabled={busy || i === detail.presentations.length - 1}
                    >
                      ↓
                    </Button>
                    <Button type="button" variant="link" size="sm" onClick={() => mark(p.id, 'presented')} disabled={busy}>
                      Presented
                    </Button>
                    <Button type="button" variant="link" size="sm" onClick={() => mark(p.id, 'absent')} disabled={busy}>
                      Absent
                    </Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => setConfirmingRemoveId(p.id)} disabled={busy}>
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-text-muted">Nothing scheduled in this session yet.</p>
        )}

        <div className="mt-3 rounded-md border border-dashed border-border p-3">
          <p className="text-xs font-medium text-text-muted">Add an accepted paper</p>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <Select value={paperId} onChange={(e) => setPaperId(e.target.value)} className="min-w-[200px] flex-1">
              <option value="">Choose a paper</option>
              {submissions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.submission_code ? `${s.submission_code} — ` : ''}
                  {s.title}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              value={paperMinutes}
              onChange={(e) => setPaperMinutes(e.target.value)}
              className="w-20"
              title="Minutes"
            />
            <Button type="button" variant="secondary" onClick={addPaper} disabled={busy || !paperId}>
              Add
            </Button>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-dashed border-border p-3">
          <p className="text-xs font-medium text-text-muted">Add a speaker talk</p>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <Select value={speakerId} onChange={(e) => setSpeakerId(e.target.value)} className="w-auto">
              <option value="">Choose a speaker</option>
              {speakers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
            <Input
              value={speakerTitle}
              onChange={(e) => setSpeakerTitle(e.target.value)}
              placeholder="Talk title"
              className="min-w-[160px] flex-1"
            />
            <Input
              type="number"
              min={1}
              value={speakerMinutes}
              onChange={(e) => setSpeakerMinutes(e.target.value)}
              className="w-20"
              title="Minutes"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addSpeakerTalk}
              disabled={busy || !speakerId || !speakerTitle.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      </div>

      <SessionTimerFields conferenceId={conferenceId} sessionId={sessionId} />

      <ConfirmDialog
        open={confirmingRemoveId !== null}
        title="Remove this from the programme?"
        message={detail?.presentations.find((p) => p.id === confirmingRemoveId)?.title ?? ''}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => confirmingRemoveId && removePresentation(confirmingRemoveId)}
        onCancel={() => setConfirmingRemoveId(null)}
      />
    </Modal>
  )
}

function SessionsSection({
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

export function ProgrammeTab({ conferenceId }: { conferenceId: string }) {
  const [roomsVersion, setRoomsVersion] = useState(0)
  const [slotsVersion, setSlotsVersion] = useState(0)
  return (
    <div className="mt-6 max-w-6xl">
      <RoomsSection conferenceId={conferenceId} onRoomsChanged={() => setRoomsVersion((v) => v + 1)} />
      <TimeSlotsSection conferenceId={conferenceId} onSlotsChanged={() => setSlotsVersion((v) => v + 1)} />
      <SessionsSection conferenceId={conferenceId} roomsVersion={roomsVersion} slotsVersion={slotsVersion} />
      <TimerDefaultsSection conferenceId={conferenceId} />
    </div>
  )
}
