import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fromKathmanduInputValue, formatKathmandu, toKathmanduInputValue } from '../../lib/datetime'
import {
  roomSchema,
  SESSION_STATUSES,
  SESSION_TYPES,
  sessionSchema,
  type SessionInput,
} from '../../lib/validation'

type Room = {
  id: string
  name: string
  building: string | null
  capacity: number | null
  status: 'active' | 'inactive'
}

type Track = { id: string; name: string }

type SessionRow = {
  id: string
  title: string
  session_type: (typeof SESSION_TYPES)[number]
  track_id: string | null
  room_id: string
  starts_at: string
  ends_at: string
  status: (typeof SESSION_STATUSES)[number]
}

const EMPTY_ROOM = { name: '', building: '', capacity: '' }

const EMPTY_SESSION_FORM = {
  title: '',
  session_type: 'paper' as (typeof SESSION_TYPES)[number],
  track_id: '',
  room_id: '',
  starts_at: '',
  ends_at: '',
  status: 'draft' as (typeof SESSION_STATUSES)[number],
}

function RoomsSection({ conferenceId }: { conferenceId: string }) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newRoom, setNewRoom] = useState(EMPTY_ROOM)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('rooms')
      .select('id, name, building, capacity, status')
      .eq('conference_id', conferenceId)
      .order('name')
    if (loadError) {
      setError(loadError.message)
    } else {
      setRooms((data ?? []) as Room[])
      setError(null)
    }
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = roomSchema.safeParse(newRoom)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setCreating(true)
    const { error: createError } = await supabase.from('rooms').insert({
      conference_id: conferenceId,
      name: parsed.data.name,
      building: parsed.data.building,
      capacity: parsed.data.capacity,
    })
    setCreating(false)
    if (createError) {
      setError(createError.message)
      return
    }
    setNewRoom(EMPTY_ROOM)
    await load()
  }

  async function handleToggle(room: Room) {
    setBusyId(room.id)
    const { error: toggleError } = await supabase
      .from('rooms')
      .update({ status: room.status === 'active' ? 'inactive' : 'active' })
      .eq('id', room.id)
    setBusyId(null)
    if (toggleError) {
      setError(toggleError.message)
      return
    }
    await load()
  }

  return (
    <div>
      <h3 className="text-lg font-medium text-ink">Rooms</h3>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-3 text-sm text-ink/60">Loading…</p>
      ) : rooms.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-white px-4 py-4 text-sm text-ink/70">
          No rooms yet.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Building</th>
                <th className="px-4 py-2 font-medium">Capacity</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2">{r.building ?? '—'}</td>
                  <td className="px-4 py-2">{r.capacity ?? '—'}</td>
                  <td className="px-4 py-2 capitalize">{r.status}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(r)}
                      disabled={busyId === r.id}
                      className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-50"
                    >
                      {r.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-ink/60">Name</label>
          <input
            value={newRoom.name}
            onChange={(e) => setNewRoom((p) => ({ ...p, name: e.target.value }))}
            className="mt-1 rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/60">Building</label>
          <input
            value={newRoom.building}
            onChange={(e) => setNewRoom((p) => ({ ...p, building: e.target.value }))}
            className="mt-1 rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/60">Capacity</label>
          <input
            type="number"
            min={1}
            value={newRoom.capacity}
            onChange={(e) => setNewRoom((p) => ({ ...p, capacity: e.target.value }))}
            className="mt-1 w-24 rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? 'Adding…' : 'Add room'}
        </button>
      </form>
    </div>
  )
}

function SessionsSection({ conferenceId }: { conferenceId: string }) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_SESSION_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: sessionsData, error: sessionsError }, { data: roomsData }, { data: tracksData }] =
      await Promise.all([
        supabase
          .from('conference_sessions')
          .select('id, title, session_type, track_id, room_id, starts_at, ends_at, status')
          .eq('conference_id', conferenceId)
          .order('starts_at'),
        supabase.from('rooms').select('id, name, building, capacity, status').eq('conference_id', conferenceId).eq('status', 'active'),
        supabase.from('conference_tracks').select('id, name').eq('conference_id', conferenceId).eq('is_active', true),
      ])

    if (sessionsError) {
      setError(sessionsError.message)
    } else {
      setSessions((sessionsData ?? []) as SessionRow[])
      setError(null)
    }
    setRooms((roomsData ?? []) as Room[])
    setTracks((tracksData ?? []) as Track[])
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

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
      starts_at: toKathmanduInputValue(session.starts_at),
      ends_at: toKathmanduInputValue(session.ends_at),
      status: session.status,
    })
    setFormError(null)
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
      conference_id: conferenceId,
      title: parsed.data.title,
      session_type: parsed.data.session_type,
      track_id: parsed.data.track_id,
      room_id: parsed.data.room_id,
      starts_at: startsIso,
      ends_at: endsIso,
      status: parsed.data.status,
    }

    const { error: saveError } = editingId
      ? await supabase.from('conference_sessions').update(payload).eq('id', editingId)
      : await supabase.from('conference_sessions').insert(payload)
    setSaving(false)

    if (saveError) {
      // Surface the database's own message (e.g. room overlap, outside conference dates) verbatim.
      setFormError(saveError.message)
      return
    }

    resetForm()
    await load()
  }

  async function handleDelete(session: SessionRow) {
    if (!window.confirm(`Delete "${session.title}"?`)) return
    setBusyId(session.id)
    const { error: deleteError } = await supabase.from('conference_sessions').delete().eq('id', session.id)
    setBusyId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    if (editingId === session.id) resetForm()
    await load()
  }

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? '—'
  const trackName = (id: string | null) => (id ? tracks.find((t) => t.id === id)?.name ?? '—' : '—')

  return (
    <div className="mt-10">
      <h3 className="text-lg font-medium text-ink">Sessions</h3>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-3 text-sm text-ink/60">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-white px-4 py-4 text-sm text-ink/70">
          No sessions yet.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Track</th>
                <th className="px-4 py-2 font-medium">Room</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">{s.title}</td>
                  <td className="px-4 py-2 capitalize">{s.session_type}</td>
                  <td className="px-4 py-2">{trackName(s.track_id)}</td>
                  <td className="px-4 py-2">{roomName(s.room_id)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatKathmandu(s.starts_at)} – {formatKathmandu(s.ends_at)}
                  </td>
                  <td className="px-4 py-2 capitalize">{s.status}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s)}
                        disabled={busyId === s.id}
                        className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-dashed border-line bg-white p-4">
        <p className="font-medium text-ink">{editingId ? 'Edit session' : 'Add a session'}</p>
        {formError ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {formError}
          </div>
        ) : null}

        <input
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          placeholder="Title"
          className="w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <select
            value={form.session_type}
            onChange={(e) => setForm((p) => ({ ...p, session_type: e.target.value as (typeof SESSION_TYPES)[number] }))}
            className="rounded-md border border-line bg-white px-3 py-2 capitalize focus:border-button"
          >
            {SESSION_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </select>

          <select
            value={form.track_id}
            onChange={(e) => setForm((p) => ({ ...p, track_id: e.target.value }))}
            className="rounded-md border border-line bg-white px-3 py-2 focus:border-button"
          >
            <option value="">No track</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            value={form.room_id}
            onChange={(e) => setForm((p) => ({ ...p, room_id: e.target.value }))}
            className="rounded-md border border-line bg-white px-3 py-2 focus:border-button"
          >
            <option value="">Choose a room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <select
            value={form.status}
            onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as (typeof SESSION_STATUSES)[number] }))}
            className="rounded-md border border-line bg-white px-3 py-2 capitalize focus:border-button"
          >
            {SESSION_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink/60">Starts (Asia/Kathmandu)</label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/60">Ends (Asia/Kathmandu)</label>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm((p) => ({ ...p, ends_at: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add session'}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </div>
  )
}

export function ProgrammeTab({ conferenceId }: { conferenceId: string }) {
  return (
    <div className="mt-6 max-w-5xl">
      <RoomsSection conferenceId={conferenceId} />
      <SessionsSection conferenceId={conferenceId} />
    </div>
  )
}
