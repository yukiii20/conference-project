import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { AUTO_CERTIFICATE_TYPES, CERTIFICATE_TYPES, certificateTemplateSchema } from '../../lib/validation'

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

  async function uploadBackground(templateId: string, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.upload(`/conferences/${conferenceId}/certificate-templates/${templateId}/background`, fd)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload this image.')
    }
  }

  async function uploadSignature(templateId: string, index: number, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.upload(`/conferences/${conferenceId}/certificate-templates/${templateId}/signatories/${index}/signature`, fd)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload this signature.')
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
    <div>
      <h3 className="text-lg font-medium text-ink">Certificate templates</h3>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-3 text-sm text-ink/60">Loading…</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{t.name}</span>{' '}
                <span className="text-ink/50">
                  ({TYPE_LABELS[t.certificate_type] ?? t.certificate_type}, {t.is_active ? 'active' : 'inactive'})
                </span>
              </span>
              <div className="flex gap-2">
                <a
                  href={`${API_BASE}/conferences/${conferenceId}/certificate-templates/${t.id}/preview.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-button hover:underline"
                >
                  Preview
                </a>
                <button type="button" onClick={() => startEdit(t)} className="text-xs text-button hover:underline">
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-dashed border-line bg-white p-4">
        <p className="font-medium text-ink">{editingId ? 'Edit template' : 'Add a template'}</p>

        <div className="grid grid-cols-2 gap-3">
          <select
            value={form.certificate_type}
            onChange={(e) => setForm((p) => ({ ...p, certificate_type: e.target.value as (typeof CERTIFICATE_TYPES)[number] }))}
            className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
          >
            {CERTIFICATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Template name"
            className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          />
        </div>

        <div>
          <p className="text-xs font-medium text-ink/60">Recipient name position</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            <input
              type="number"
              value={form.layout.name.y}
              onChange={(e) => setForm((p) => ({ ...p, layout: { name: { ...p.layout.name, y: Number(e.target.value) } } }))}
              placeholder="Y position"
              className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
            />
            <input
              type="number"
              value={form.layout.name.font_size}
              onChange={(e) => setForm((p) => ({ ...p, layout: { name: { ...p.layout.name, font_size: Number(e.target.value) } } }))}
              placeholder="Font size"
              className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
            />
            <input
              value={form.layout.name.color}
              onChange={(e) => setForm((p) => ({ ...p, layout: { name: { ...p.layout.name, color: e.target.value } } }))}
              placeholder="#1A1A1A"
              className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-ink/60">Signatories (up to 2)</p>
          {[0, 1].map((i) => (
            <div key={i} className="mt-1 grid grid-cols-2 gap-2">
              <input
                value={form.signatories[i]?.name ?? ''}
                onChange={(e) => setSignatory(i, 'name', e.target.value)}
                placeholder="Name"
                className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
              />
              <input
                value={form.signatories[i]?.title ?? ''}
                onChange={(e) => setSignatory(i, 'title', e.target.value)}
                placeholder="Title"
                className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
              />
            </div>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
          Active (one active template per type)
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add template'}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} className="rounded-md border border-line px-4 py-2 text-sm hover:bg-background">
              Cancel
            </button>
          ) : null}
        </div>

        {editingTemplate ? (
          <div className="border-t border-line pt-3">
            <p className="text-xs font-medium text-ink/60">Background image (A4 landscape)</p>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadBackground(editingTemplate.id, file)
              }}
              className="mt-1 text-sm"
            />
            {[0, 1].map((i) => (
              <div key={i} className="mt-2">
                <p className="text-xs font-medium text-ink/60">Signature {i + 1} image</p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadSignature(editingTemplate.id, i, file)
                  }}
                  className="mt-1 text-sm"
                />
              </div>
            ))}
          </div>
        ) : null}
      </form>
    </div>
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
      <div className="rounded-lg border border-line bg-white p-4">
        <h3 className="text-lg font-medium text-ink">Generate certificates</h3>
        {message ? <p className="mt-2 text-sm text-ink/70">{message}</p> : null}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as (typeof AUTO_CERTIFICATE_TYPES)[number])}
            className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
          >
            {AUTO_CERTIFICATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {preview ? (
            <span className="text-sm text-ink/60">
              {preview.eligible} eligible · {preview.new} new · {preview.already_issued} already issued
            </span>
          ) : null}
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Generate certificates
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <h3 className="text-lg font-medium text-ink">Best paper (manual)</h3>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select
            value={submissionId}
            onChange={(e) => setSubmissionId(e.target.value)}
            className="min-w-[240px] flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
          >
            <option value="">Choose a submission</option>
            {submissions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.submission_code ? `${s.submission_code} — ` : ''}
                {s.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={issueBestPaper}
            disabled={busy || !submissionId}
            className="rounded-md border border-line px-4 py-2 text-sm hover:bg-background disabled:opacity-50"
          >
            Issue to authors
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <h3 className="text-lg font-medium text-ink">Speaker (manual)</h3>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
            className="min-w-[240px] flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
          >
            <option value="">Choose a speaker</option>
            {speakers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={issueSpeaker}
            disabled={busy || !speakerId}
            className="rounded-md border border-line px-4 py-2 text-sm hover:bg-background disabled:opacity-50"
          >
            Issue
          </button>
        </div>
      </div>
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
        <h3 className="text-lg font-medium text-ink">Issued certificates</h3>
        <button
          type="button"
          onClick={releaseNow}
          disabled={releasing}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50"
        >
          {releasing ? 'Releasing…' : 'Release now'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-3 text-sm text-ink/60">Loading…</p>
      ) : certificates.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-white px-4 py-4 text-sm text-ink/70">No certificates issued yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Recipient</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Issued</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {certificates.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-mono text-xs">{c.certificate_number}</td>
                  <td className="px-4 py-2">{c.recipient_name}</td>
                  <td className="px-4 py-2">{TYPE_LABELS[c.certificate_type] ?? c.certificate_type}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatKathmandu(c.issued_at)}</td>
                  <td className="px-4 py-2 capitalize">{c.status}</td>
                  <td className="px-4 py-2">
                    {c.status === 'issued' ? (
                      <button type="button" onClick={() => revoke(c.id)} className="text-xs text-red-600 hover:underline">
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
