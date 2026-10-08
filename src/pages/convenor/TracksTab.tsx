import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { trackSchema } from '../../lib/validation'

type Track = {
  id: string
  code: string | null
  name: string
  description: string | null
  display_order: number
  is_active: boolean
}

type EditState = { name: string; code: string; description: string }

function toEditState(t: Track): EditState {
  return { name: t.name, code: t.code ?? '', description: t.description ?? '' }
}

const EMPTY_NEW: EditState = { name: '', code: '', description: '' }

export function TracksTab({ conferenceId }: { conferenceId: string }) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, EditState>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newTrack, setNewTrack] = useState<EditState>(EMPTY_NEW)
  const [newError, setNewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('conference_tracks')
      .select('id, code, name, description, display_order, is_active')
      .eq('conference_id', conferenceId)
      .order('display_order', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    const list = (data ?? []) as Track[]
    setTracks(list)
    setEdits(Object.fromEntries(list.map((t) => [t.id, toEditState(t)])))
    setError(null)
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function updateEdit(id: string, patch: Partial<EditState>) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function handleSaveRow(track: Track) {
    const edit = edits[track.id]
    const parsed = trackSchema.safeParse(edit)
    if (!parsed.success) {
      setRowErrors((prev) => ({ ...prev, [track.id]: parsed.error.issues[0]?.message ?? 'Invalid value.' }))
      return
    }
    setRowErrors((prev) => ({ ...prev, [track.id]: '' }))
    setBusyId(track.id)
    const { error: saveError } = await supabase
      .from('conference_tracks')
      .update(parsed.data)
      .eq('id', track.id)
    setBusyId(null)
    if (saveError) {
      setRowErrors((prev) => ({ ...prev, [track.id]: saveError.message }))
      return
    }
    await load()
  }

  async function handleToggleActive(track: Track) {
    setBusyId(track.id)
    const { error: toggleError } = await supabase
      .from('conference_tracks')
      .update({ is_active: !track.is_active })
      .eq('id', track.id)
    setBusyId(null)
    if (toggleError) {
      setRowErrors((prev) => ({ ...prev, [track.id]: toggleError.message }))
      return
    }
    await load()
  }

  async function handleMove(track: Track, direction: 'up' | 'down') {
    const sorted = [...tracks].sort((a, b) => a.display_order - b.display_order)
    const index = sorted.findIndex((t) => t.id === track.id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return
    const other = sorted[swapIndex]

    setBusyId(track.id)
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('conference_tracks').update({ display_order: other.display_order }).eq('id', track.id),
      supabase.from('conference_tracks').update({ display_order: track.display_order }).eq('id', other.id),
    ])
    setBusyId(null)
    if (e1 || e2) {
      setError((e1 ?? e2)?.message ?? 'Could not reorder tracks.')
      return
    }
    await load()
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setNewError(null)
    const parsed = trackSchema.safeParse(newTrack)
    if (!parsed.success) {
      setNewError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setCreating(true)
    const nextOrder = tracks.length === 0 ? 0 : Math.max(...tracks.map((t) => t.display_order)) + 1
    const { error: createError } = await supabase.from('conference_tracks').insert({
      conference_id: conferenceId,
      ...parsed.data,
      display_order: nextOrder,
    })
    setCreating(false)
    if (createError) {
      setNewError(createError.message)
      return
    }
    setNewTrack(EMPTY_NEW)
    await load()
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  const sorted = [...tracks].sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="mt-6 max-w-3xl">
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="space-y-3">
        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
            No tracks yet.
          </p>
        ) : (
          sorted.map((track, i) => {
            const edit = edits[track.id] ?? toEditState(track)
            return (
              <div key={track.id} className={`rounded-lg border border-line bg-white p-4 ${track.is_active ? '' : 'opacity-60'}`}>
                {rowErrors[track.id] ? <p className="mb-2 text-sm text-red-600">{rowErrors[track.id]}</p> : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
                  <div>
                    <label className="block text-xs font-medium text-ink/60">Name</label>
                    <input
                      value={edit.name}
                      onChange={(e) => updateEdit(track.id, { name: e.target.value })}
                      className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink/60">Code</label>
                    <input
                      value={edit.code}
                      onChange={(e) => updateEdit(track.id, { code: e.target.value })}
                      className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium text-ink/60">Description</label>
                  <textarea
                    value={edit.description}
                    onChange={(e) => updateEdit(track.id, { description: e.target.value })}
                    rows={2}
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSaveRow(track)}
                    disabled={busyId === track.id}
                    className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(track, 'up')}
                    disabled={busyId === track.id || i === 0}
                    className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(track, 'down')}
                    disabled={busyId === track.id || i === sorted.length - 1}
                    className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(track)}
                    disabled={busyId === track.id}
                    className="ml-auto rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-50"
                  >
                    {track.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <form onSubmit={handleCreate} className="mt-6 rounded-lg border border-dashed border-line bg-white p-4">
        <p className="font-medium text-ink">Add a track</p>
        {newError ? <p className="mt-2 text-sm text-red-600">{newError}</p> : null}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
          <input
            value={newTrack.name}
            onChange={(e) => setNewTrack((p) => ({ ...p, name: e.target.value }))}
            placeholder="Track name"
            className="rounded-md border border-line px-3 py-2 focus:border-button"
          />
          <input
            value={newTrack.code}
            onChange={(e) => setNewTrack((p) => ({ ...p, code: e.target.value }))}
            placeholder="Code (optional)"
            className="rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <textarea
          value={newTrack.description}
          onChange={(e) => setNewTrack((p) => ({ ...p, description: e.target.value }))}
          placeholder="Description (optional)"
          rows={2}
          className="mt-3 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        <button
          type="submit"
          disabled={creating}
          className="mt-3 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? 'Adding…' : 'Add track'}
        </button>
      </form>
    </div>
  )
}
