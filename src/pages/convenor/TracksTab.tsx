import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { trackSchema } from '../../lib/validation'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader, Card, FormField, Input, Textarea, Button, Alert, Spinner } from '../../components/ui'

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
    try {
      const data = await api.get<{ tracks: Track[] }>(`/conferences/${conferenceId}/tracks`)
      setTracks(data.tracks)
      setEdits(Object.fromEntries(data.tracks.map((t) => [t.id, toEditState(t)])))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load tracks.')
    } finally {
      setLoading(false)
    }
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
    try {
      await api.patch(`/conferences/${conferenceId}/tracks/${track.id}`, parsed.data)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [track.id]: err instanceof ApiError ? err.message : 'Could not save this.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleActive(track: Track) {
    setBusyId(track.id)
    try {
      await api.patch(`/conferences/${conferenceId}/tracks/${track.id}/deactivate`, { is_active: !track.is_active })
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [track.id]: err instanceof ApiError ? err.message : 'Could not update this.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleMove(track: Track, direction: 'up' | 'down') {
    const sorted = [...tracks].sort((a, b) => a.display_order - b.display_order)
    const index = sorted.findIndex((t) => t.id === track.id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return

    const reordered = [...sorted]
    const tmp = reordered[index]!
    reordered[index] = reordered[swapIndex]!
    reordered[swapIndex] = tmp

    setBusyId(track.id)
    try {
      await api.post(`/conferences/${conferenceId}/tracks/reorder`, { track_ids: reordered.map((t) => t.id) })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder tracks.')
    } finally {
      setBusyId(null)
    }
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
    try {
      await api.post(`/conferences/${conferenceId}/tracks`, parsed.data)
      setNewTrack(EMPTY_NEW)
      await load()
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : 'Could not create this track.')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  const sorted = [...tracks].sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="Tracks" subtitle="Create and order the submission tracks for this conference." />
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="space-y-3">
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface">
            <EmptyState title="No tracks yet." message="Add your first track using the form below." />
          </div>
        ) : (
          sorted.map((track, i) => {
            const edit = edits[track.id] ?? toEditState(track)
            return (
              <Card key={track.id} className={track.is_active ? '' : 'opacity-60'}>
                {rowErrors[track.id] ? (
                  <div className="mb-2">
                    <Alert variant="danger">{rowErrors[track.id]}</Alert>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
                  <FormField label="Name">
                    <Input value={edit.name} onChange={(e) => updateEdit(track.id, { name: e.target.value })} />
                  </FormField>
                  <FormField label="Code">
                    <Input value={edit.code} onChange={(e) => updateEdit(track.id, { code: e.target.value })} />
                  </FormField>
                </div>
                <div className="mt-3">
                  <FormField label="Description">
                    <Textarea value={edit.description} onChange={(e) => updateEdit(track.id, { description: e.target.value })} rows={2} />
                  </FormField>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => handleSaveRow(track)} disabled={busyId === track.id}>
                    Save
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleMove(track, 'up')} disabled={busyId === track.id || i === 0}>
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleMove(track, 'down')}
                    disabled={busyId === track.id || i === sorted.length - 1}
                  >
                    ↓
                  </Button>
                  <Button variant="secondary" size="sm" className="ml-auto" onClick={() => handleToggleActive(track)} disabled={busyId === track.id}>
                    {track.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </Card>
            )
          })
        )}
      </div>

      <form onSubmit={handleCreate} className="mt-6 rounded-lg border border-dashed border-border bg-surface p-4">
        <p className="font-medium text-text">Add a track</p>
        {newError ? (
          <div className="mt-2">
            <Alert variant="danger">{newError}</Alert>
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
          <Input
            value={newTrack.name}
            onChange={(e) => setNewTrack((p) => ({ ...p, name: e.target.value }))}
            placeholder="Track name"
          />
          <Input
            value={newTrack.code}
            onChange={(e) => setNewTrack((p) => ({ ...p, code: e.target.value }))}
            placeholder="Code (optional)"
          />
        </div>
        <Textarea
          value={newTrack.description}
          onChange={(e) => setNewTrack((p) => ({ ...p, description: e.target.value }))}
          placeholder="Description (optional)"
          rows={2}
          className="mt-3"
        />
        <Button type="submit" variant="primary" className="mt-3" disabled={creating} loading={creating}>
          {creating ? 'Adding…' : 'Add track'}
        </Button>
      </form>
    </div>
  )
}
