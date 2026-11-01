import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { api, ApiError } from '../../../lib/api'
import { AUTO_CERTIFICATE_TYPES } from '../../../lib/validation'
import { Button, Card, CardHeader, Select } from '../../../components/ui'
import { Icon } from '../../../components/ui/Icon'
import { TYPE_LABELS, type Speaker, type Submission } from './shared'

export function IssueSection({ conferenceId, onIssued }: { conferenceId: string; onIssued: () => void }) {
  const [type, setType] = useState<(typeof AUTO_CERTIFICATE_TYPES)[number]>('participation')
  const [preview, setPreview] = useState<{ eligible: number; already_issued: number; new: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [submissionId, setSubmissionId] = useState('')
  const [speakerId, setSpeakerId] = useState('')

  const loadPreview = useCallback(async () => {
    try {
      const data = await api.get<{ eligible: number; already_issued: number; new: number }>(`/conferences/${conferenceId}/certificates/preview`, {
        type,
      })
      setPreview(data)
    } catch {
      setPreview(null)
    }
  }, [conferenceId, type])

  useEffect(() => {
    loadPreview()
  }, [loadPreview])

  useEffect(() => {
    api
      .get<{ submissions: Submission[] }>(`/conferences/${conferenceId}/submissions`)
      .then((d) => setSubmissions(d.submissions))
      .catch(() => setSubmissions([]))
    api
      .get<{ speakers: Speaker[] }>(`/conferences/${conferenceId}/speakers`)
      .then((d) => setSpeakers(d.speakers))
      .catch(() => setSpeakers([]))
  }, [conferenceId])

  async function generate() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.post<{ issued: number; skipped: number }>(`/conferences/${conferenceId}/certificates/generate`, {
        certificate_type: type,
      })
      setMessage(`Issued ${res.issued}, already had one: ${res.skipped}.`)
      await loadPreview()
      onIssued()
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not generate certificates.')
    } finally {
      setBusy(false)
    }
  }

  async function issueBestPaper() {
    if (!submissionId) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.post<{ issued: number; skipped: number }>(`/conferences/${conferenceId}/certificates/best-paper`, {
        submission_id: submissionId,
      })
      setMessage(`Issued ${res.issued} best-paper certificate(s).`)
      onIssued()
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not issue this certificate.')
    } finally {
      setBusy(false)
    }
  }

  async function issueSpeaker() {
    if (!speakerId) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.post<{ issued: boolean }>(`/conferences/${conferenceId}/certificates/speaker`, { speaker_id: speakerId })
      setMessage(res.issued ? 'Speaker certificate issued.' : 'Already issued.')
      onIssued()
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not issue this certificate.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-10 space-y-6">
      <Card>
        <CardHeader title="Generate certificates" />
        {message ? <p className="mt-2 text-sm text-text-muted">{message}</p> : null}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value as (typeof AUTO_CERTIFICATE_TYPES)[number])} className="w-auto">
            {AUTO_CERTIFICATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          {preview ? (
            <span className="text-sm text-text-muted">
              {preview.eligible} eligible · {preview.new} new · {preview.already_issued} already issued
            </span>
          ) : null}
          <Button type="button" variant="primary" onClick={generate} disabled={busy} iconLeft={<Icon icon={Sparkles} size={16} />}>
            Generate certificates
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Best paper (manual)" />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} className="min-w-[240px] flex-1">
            <option value="">Choose a submission</option>
            {submissions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.submission_code ? `${s.submission_code} — ` : ''}
                {s.title}
              </option>
            ))}
          </Select>
          <Button type="button" variant="primary" onClick={issueBestPaper} disabled={busy || !submissionId}>
            Issue to authors
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Speaker (manual)" />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select value={speakerId} onChange={(e) => setSpeakerId(e.target.value)} className="min-w-[240px] flex-1">
            <option value="">Choose a speaker</option>
            {speakers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </Select>
          <Button type="button" variant="primary" onClick={issueSpeaker} disabled={busy || !speakerId}>
            Issue
          </Button>
        </div>
      </Card>
    </div>
  )
}
