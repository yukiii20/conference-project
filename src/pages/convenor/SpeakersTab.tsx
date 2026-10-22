import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { SPEAKER_TYPES, speakerSchema, type SpeakerInput } from '../../lib/validation'
import { ImageUpload } from '../../components/ImageUpload'
import { ConfirmDialog } from '../../components/ui/Modal'
import { Alert, Button, EmptyState, Input, Select, Spinner, Textarea } from '../../components/ui'

const MAX_MB = 2

type Speaker = {
  id: string
  full_name: string
  designation: string | null
  affiliation: string | null
  bio: string | null
  photo_path: string | null
  speaker_type: (typeof SPEAKER_TYPES)[number]
  display_order: number
  is_public: boolean
}

type EditState = { full_name: string; designation: string; affiliation: string; bio: string; speaker_type: SpeakerInput['speaker_type'] }

function toEditState(s: Speaker): EditState {
  return {
    full_name: s.full_name,
    designation: s.designation ?? '',
    affiliation: s.affiliation ?? '',
    bio: s.bio ?? '',
    speaker_type: s.speaker_type,
  }
}

const EMPTY_NEW: EditState = { full_name: '', designation: '', affiliation: '', bio: '', speaker_type: 'invited' }

const TYPE_LABELS: Record<SpeakerInput['speaker_type'], string> = {
  keynote: 'Keynote',
  invited: 'Invited',
  panelist: 'Panelist',
  guest: 'Guest',
}

export function SpeakersTab({ conferenceId }: { conferenceId: string }) {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, EditState>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<Speaker | null>(null)
  const [newSpeaker, setNewSpeaker] = useState<EditState>(EMPTY_NEW)
  const [newError, setNewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ speakers: Speaker[] }>(`/conferences/${conferenceId}/speakers`)
      setSpeakers(data.speakers)
      setEdits(Object.fromEntries(data.speakers.map((s) => [s.id, toEditState(s)])))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load speakers.')
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

  async function handleSaveRow(speaker: Speaker) {
    const edit = edits[speaker.id]
    const parsed = speakerSchema.safeParse({ ...edit, is_public: speaker.is_public })
    if (!parsed.success) {
      setRowErrors((prev) => ({ ...prev, [speaker.id]: parsed.error.issues[0]?.message ?? 'Invalid value.' }))
      return
    }
    setRowErrors((prev) => ({ ...prev, [speaker.id]: '' }))
    setBusyId(speaker.id)
    try {
      await api.patch(`/conferences/${conferenceId}/speakers/${speaker.id}`, parsed.data)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [speaker.id]: err instanceof ApiError ? err.message : 'Could not save this.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleTogglePublic(speaker: Speaker) {
    setBusyId(speaker.id)
    try {
      await api.patch(`/conferences/${conferenceId}/speakers/${speaker.id}`, { is_public: !speaker.is_public })
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [speaker.id]: err instanceof ApiError ? err.message : 'Could not update this.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleMove(speaker: Speaker, direction: 'up' | 'down') {
    const sorted = [...speakers].sort((a, b) => a.display_order - b.display_order)
    const index = sorted.findIndex((s) => s.id === speaker.id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return

    const reordered = [...sorted]
    const tmp = reordered[index]!
    reordered[index] = reordered[swapIndex]!
    reordered[swapIndex] = tmp

    setBusyId(speaker.id)
    try {
      await api.post(`/conferences/${conferenceId}/speakers/reorder`, { speaker_ids: reordered.map((s) => s.id) })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder speakers.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(speaker: Speaker) {
    setConfirmingRemove(null)
    setBusyId(speaker.id)
    try {
      await api.del(`/conferences/${conferenceId}/speakers/${speaker.id}`)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [speaker.id]: err instanceof ApiError ? err.message : 'Could not delete this.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setNewError(null)
    const parsed = speakerSchema.safeParse({ ...newSpeaker, is_public: true })
    if (!parsed.success) {
      setNewError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setCreating(true)
    try {
      await api.post(`/conferences/${conferenceId}/speakers`, parsed.data)
      setNewSpeaker(EMPTY_NEW)
      await load()
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : 'Could not create this speaker.')
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

  const sorted = [...speakers].sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="mt-6 max-w-3xl">
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No speakers yet." />
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((speaker, i) => {
            const edit = edits[speaker.id] ?? toEditState(speaker)
            return (
              <div key={speaker.id} className={`rounded-lg border border-border bg-surface p-4 ${speaker.is_public ? '' : 'opacity-60'}`}>
                {rowErrors[speaker.id] ? <p className="mb-2 text-sm text-danger">{rowErrors[speaker.id]}</p> : null}
                <div className="flex flex-wrap gap-4">
                  <ImageUpload
                    label="photo"
                    currentPath={speaker.photo_path}
                    maxSizeMB={MAX_MB}
                    aspect="square"
                    size="sm"
                    uploadUrl={`/api/conferences/${conferenceId}/speakers/${speaker.id}/photo`}
                    removeUrl={`/api/conferences/${conferenceId}/speakers/${speaker.id}/photo`}
                    onSaved={() => load()}
                    onRemoved={() => load()}
                  />
                  <div className="min-w-[220px] flex-1 space-y-2">
                    <Input
                      value={edit.full_name}
                      onChange={(e) => updateEdit(speaker.id, { full_name: e.target.value })}
                      placeholder="Full name"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={edit.designation}
                        onChange={(e) => updateEdit(speaker.id, { designation: e.target.value })}
                        placeholder="Designation"
                        className="flex-1"
                      />
                      <Input
                        value={edit.affiliation}
                        onChange={(e) => updateEdit(speaker.id, { affiliation: e.target.value })}
                        placeholder="Affiliation"
                        className="flex-1"
                      />
                      <Select
                        value={edit.speaker_type}
                        onChange={(e) => updateEdit(speaker.id, { speaker_type: e.target.value as SpeakerInput['speaker_type'] })}
                        className="w-auto"
                      >
                        {SPEAKER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Textarea
                      value={edit.bio}
                      onChange={(e) => updateEdit(speaker.id, { bio: e.target.value })}
                      placeholder="Bio"
                      rows={2}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" onClick={() => handleSaveRow(speaker)} disabled={busyId === speaker.id}>
                    Save
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => handleMove(speaker, 'up')} disabled={busyId === speaker.id || i === 0}>
                    ↑
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => handleMove(speaker, 'down')} disabled={busyId === speaker.id || i === sorted.length - 1}>
                    ↓
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => handleTogglePublic(speaker)} disabled={busyId === speaker.id}>
                    {speaker.is_public ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setConfirmingRemove(speaker)}
                    disabled={busyId === speaker.id}
                  >
                    Delete speaker
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-6 rounded-lg border border-dashed border-border bg-surface p-4">
        <p className="font-medium text-text">Add a speaker</p>
        {newError ? (
          <div className="mt-2">
            <Alert variant="danger">{newError}</Alert>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            value={newSpeaker.full_name}
            onChange={(e) => setNewSpeaker((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Full name"
            className="flex-1"
          />
          <Select
            value={newSpeaker.speaker_type}
            onChange={(e) => setNewSpeaker((p) => ({ ...p, speaker_type: e.target.value as SpeakerInput['speaker_type'] }))}
            className="w-auto"
          >
            {SPEAKER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <p className="mt-2 text-xs text-text-muted">Add the photo after creating, from the row below.</p>
        <Button type="submit" className="mt-3" loading={creating}>
          Add speaker
        </Button>
      </form>

      <ConfirmDialog
        open={confirmingRemove !== null}
        title={`Delete ${confirmingRemove?.full_name ?? 'this speaker'}?`}
        message="This also removes their photo. This cannot be undone."
        confirmLabel="Delete"
        busy={busyId === confirmingRemove?.id}
        onConfirm={() => confirmingRemove && handleRemove(confirmingRemove)}
        onCancel={() => setConfirmingRemove(null)}
      />
    </div>
  )
}
