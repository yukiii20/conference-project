import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../../lib/api'
import { SessionTimerFields } from '../SessionTimerSettings'
import { formatKathmandu } from '../../../lib/datetime'
import { Alert, Button, ConfirmDialog, Input, Modal, Select } from '../../../components/ui'
import { type ChairCandidate, type SchedulableSubmission, type SessionDetail, type Speaker } from './shared'

export function SessionManagePanel({
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
