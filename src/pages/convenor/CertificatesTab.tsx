import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { AUTO_CERTIFICATE_TYPES, CERTIFICATE_TYPES, certificateTemplateSchema } from '../../lib/validation'
import { ImageUpload } from '../../components/ImageUpload'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Input,
  Select,
  SkeletonText,
  StatusChip,
  TableContainer,
} from '../../components/ui'

type Signatory = { name: string; title: string; signature_path: string | null }
type Template = {
  id: string
  certificate_type: string
  name: string
  background_path: string | null
  layout: { name: { y: number; font_size: number; color: string } }
  signatories: Signatory[]
  is_active: boolean
}

type Certificate = {
  id: string
  recipient_name: string
  certificate_type: string
  certificate_number: string
  issued_at: string
  status: string
  revoked_reason: string | null
}

type Submission = { id: string; submission_code: string | null; title: string; status: string }
type Speaker = { id: string; full_name: string }

const TYPE_LABELS: Record<string, string> = {
  participation: 'Participation',
  presentation: 'Presentation',
  speaker: 'Speaker',
  reviewer: 'Reviewer',
  session_chair: 'Session chair',
  staff: 'Staff',
  best_paper: 'Best paper',
}

const EMPTY_FORM = {
  certificate_type: 'participation' as (typeof CERTIFICATE_TYPES)[number],
  name: '',
  layout: { name: { y: 260, font_size: 48, color: '#1A1A1A' } },
  signatories: [] as Signatory[],
  is_active: true,
}

function TemplatesSection({ conferenceId, onChanged }: { conferenceId: string; onChanged: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ templates: Template[] }>(`/conferences/${conferenceId}/certificate-templates`)
      setTemplates(data.templates)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load certificate templates.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function startEdit(t: Template) {
    setEditingId(t.id)
    setForm({ certificate_type: t.certificate_type as (typeof CERTIFICATE_TYPES)[number], name: t.name, layout: t.layout, signatories: t.signatories, is_active: t.is_active })
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = certificateTemplateSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await api.patch(`/conferences/${conferenceId}/certificate-templates/${editingId}`, parsed.data)
      } else {
        await api.post(`/conferences/${conferenceId}/certificate-templates`, parsed.data)
      }
      resetForm()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this template.')
    } finally {
      setSaving(false)
    }
  }

  function setSignatory(index: number, field: 'name' | 'title', value: string) {
    setForm((p) => {
      const signatories = [...p.signatories]
      while (signatories.length <= index) signatories.push({ name: '', title: '', signature_path: null })
      signatories[index] = { ...signatories[index]!, [field]: value }
      return { ...p, signatories }
    })
  }

  const editingTemplate = templates.find((t) => t.id === editingId) ?? null

  return (
    <Card>
      <CardHeader title="Certificate templates" />
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {loading ? (
        <SkeletonText lines={3} className="mt-3" />
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No certificate templates yet." />
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-text">{t.name}</span>{' '}
                <span className="text-text-muted">
                  ({TYPE_LABELS[t.certificate_type] ?? t.certificate_type}, {t.is_active ? 'active' : 'inactive'})
                </span>
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={`${API_BASE}/conferences/${conferenceId}/certificate-templates/${t.id}/preview.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-button hover:underline"
                >
                  Preview
                </a>
                <Button type="button" variant="link" size="sm" onClick={() => startEdit(t)}>
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-dashed border-border bg-surface p-4">
        <p className="font-medium text-text">{editingId ? 'Edit template' : 'Add a template'}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            value={form.certificate_type}
            onChange={(e) => setForm((p) => ({ ...p, certificate_type: e.target.value as (typeof CERTIFICATE_TYPES)[number] }))}
          >
            {CERTIFICATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Template name"
          />
        </div>

        <div>
          <p className="text-xs font-medium text-text-muted">Recipient name position</p>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input
              type="number"
              value={form.layout.name.y}
              onChange={(e) => setForm((p) => ({ ...p, layout: { name: { ...p.layout.name, y: Number(e.target.value) } } }))}
              placeholder="Y position"
            />
            <Input
              type="number"
              value={form.layout.name.font_size}
              onChange={(e) => setForm((p) => ({ ...p, layout: { name: { ...p.layout.name, font_size: Number(e.target.value) } } }))}
              placeholder="Font size"
            />
            <Input
              value={form.layout.name.color}
              onChange={(e) => setForm((p) => ({ ...p, layout: { name: { ...p.layout.name, color: e.target.value } } }))}
              placeholder="#1A1A1A"
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-text-muted">Signatories (up to 2)</p>
          {[0, 1].map((i) => (
            <div key={i} className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={form.signatories[i]?.name ?? ''}
                onChange={(e) => setSignatory(i, 'name', e.target.value)}
                placeholder="Name"
              />
              <Input
                value={form.signatories[i]?.title ?? ''}
                onChange={(e) => setSignatory(i, 'title', e.target.value)}
                placeholder="Title"
              />
            </div>
          ))}
        </div>

        <Checkbox
          label="Active (one active template per type)"
          checked={form.is_active}
          onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
        />

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add template'}
          </Button>
          {editingId ? (
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
          ) : null}
        </div>

        {editingTemplate ? (
          <div className="space-y-4 border-t border-border pt-3">
            <div>
              <p className="text-xs font-medium text-text-muted">Certificate background</p>
              <p className="text-xs text-text-muted/70">PNG or JPG, A4 landscape, at least 2480 x 1754 px</p>
              <div className="mt-2">
                <ImageUpload
                  label="certificate background"
                  currentPath={editingTemplate.background_path}
                  uploadUrl={`${API_BASE}/conferences/${conferenceId}/certificate-templates/${editingTemplate.id}/background`}
                  removeUrl={`${API_BASE}/conferences/${conferenceId}/certificate-templates/${editingTemplate.id}/background`}
                  onSaved={() => load()}
                  onRemoved={() => load()}
                  maxSizeMB={5}
                  aspect="square"
                  size="sm"
                  uploadButtonText="Upload background"
                  replaceButtonText="Replace image"
                />
              </div>
            </div>

            {([0, 1] as const).map((i) => {
              const positionLabel = i === 0 ? 'First signature' : 'Second signature'
              return (
                <div key={i}>
                  <p className="text-xs font-medium text-text-muted">{positionLabel}</p>
                  <p className="text-xs text-text-muted/70">Transparent PNG, about 600 x 200 px</p>
                  <div className="mt-2">
                    <ImageUpload
                      label={positionLabel.toLowerCase()}
                      currentPath={editingTemplate.signatories[i]?.signature_path ?? null}
                      uploadUrl={`${API_BASE}/conferences/${conferenceId}/certificate-templates/${editingTemplate.id}/signatories/${i}/signature`}
                      removeUrl={`${API_BASE}/conferences/${conferenceId}/certificate-templates/${editingTemplate.id}/signatories/${i}/signature`}
                      onSaved={() => load()}
                      onRemoved={() => load()}
                      maxSizeMB={2}
                      aspect="square"
                      size="sm"
                      uploadButtonText={`Upload ${positionLabel.toLowerCase()}`}
                      replaceButtonText="Replace image"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </form>
    </Card>
  )
}

function IssueSection({ conferenceId, onIssued }: { conferenceId: string; onIssued: () => void }) {
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
          <Button type="button" variant="primary" onClick={generate} disabled={busy}>
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

function IssuedListSection({ conferenceId, refreshKey }: { conferenceId: string; refreshKey: number }) {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [releasing, setReleasing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ certificates: Certificate[] }>(`/conferences/${conferenceId}/certificates`)
      setCertificates(data.certificates)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load certificates.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function revoke(id: string) {
    const reason = window.prompt('Reason for revoking this certificate?')
    if (!reason) return
    try {
      await api.patch(`/conferences/${conferenceId}/certificates/${id}/revoke`, { reason })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke this certificate.')
    }
  }

  async function releaseNow() {
    setReleasing(true)
    try {
      await api.post(`/conferences/${conferenceId}/certificates/release-now`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not release certificates.')
    } finally {
      setReleasing(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-medium text-text">Issued certificates</h3>
        <Button type="button" variant="secondary" size="sm" onClick={releaseNow} disabled={releasing}>
          {releasing ? 'Releasing…' : 'Release now'}
        </Button>
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {loading ? (
        <SkeletonText lines={3} className="mt-3" />
      ) : certificates.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No certificates issued yet." />
        </div>
      ) : (
        <div className="mt-3">
          <TableContainer minWidth={700}>
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-muted">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Recipient</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Issued</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {certificates.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-mono text-xs">{c.certificate_number}</td>
                  <td className="px-4 py-2">{c.recipient_name}</td>
                  <td className="px-4 py-2">{TYPE_LABELS[c.certificate_type] ?? c.certificate_type}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatKathmandu(c.issued_at)}</td>
                  <td className="px-4 py-2">
                    <StatusChip status={c.status} />
                  </td>
                  <td className="px-4 py-2">
                    {c.status === 'issued' ? (
                      <Button type="button" variant="danger" size="sm" onClick={() => revoke(c.id)}>
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      )}
    </div>
  )
}

export function CertificatesTab({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="mt-6 max-w-5xl">
      <TemplatesSection conferenceId={conferenceId} onChanged={() => setRefreshKey((k) => k + 1)} />
      <IssueSection conferenceId={conferenceId} onIssued={() => setRefreshKey((k) => k + 1)} />
      <IssuedListSection conferenceId={conferenceId} refreshKey={refreshKey} />
    </div>
  )
}
