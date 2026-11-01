import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Plus, RotateCcw, Save, Send, Sparkles, Trash2 } from 'lucide-react'
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
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  SkeletonText,
  StatusChip,
  TableContainer,
} from '../../components/ui'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'

type Signatory = { name: string; title: string; signature_path: string | null }

type TextKey = 'header' | 'title' | 'subtitle' | 'intro' | 'wording' | 'event' | 'seal'
type ColorKey = 'frame' | 'accent' | 'title' | 'text' | 'background'
type ShowKey = 'logo' | 'frame' | 'header' | 'subtitle' | 'intro' | 'seal' | 'number' | 'issued' | 'qr'

type Layout = {
  name: { y: number; font_size: number; color: string }
  texts?: Partial<Record<TextKey, string>>
  colors?: Partial<Record<ColorKey, string>>
  show?: Partial<Record<ShowKey, boolean>>
  font?: 'serif' | 'sans'
}

type Template = {
  id: string
  certificate_type: string
  name: string
  background_path: string | null
  layout: Layout
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

// Must match server/src/modules/certificates/export.ts (shown as placeholders: empty = default).
const DEFAULT_WORDING: Record<string, string> = {
  participation: 'has participated in',
  presentation: 'has presented a paper at',
  speaker: 'has delivered an invited talk at',
  reviewer: 'has served as a reviewer for',
  session_chair: 'has chaired a session at',
  staff: 'has served as organising staff for',
  best_paper: 'has received the Best Paper Award at',
}
const DEFAULT_SUBTITLE: Record<string, string> = {
  participation: 'of Participation',
  presentation: 'of Presentation',
  speaker: 'of Appreciation',
  reviewer: 'of Appreciation',
  session_chair: 'of Appreciation',
  staff: 'of Appreciation',
  best_paper: 'of Excellence',
}

const TEXT_FIELDS: Array<{ key: TextKey; label: string; max: number; help?: string; placeholder: (type: string) => string }> = [
  { key: 'header', label: 'Top line', max: 150, help: 'Small line above the title, shown in capitals.', placeholder: () => '{conference}' },
  { key: 'title', label: 'Title', max: 60, placeholder: () => 'CERTIFICATE' },
  { key: 'subtitle', label: 'Subtitle', max: 80, help: 'Shown in capitals under the title.', placeholder: (t) => DEFAULT_SUBTITLE[t] ?? 'of Recognition' },
  { key: 'intro', label: 'Line above the name', max: 120, placeholder: () => 'This is to certify that' },
  { key: 'wording', label: 'Line below the name', max: 150, placeholder: (t) => DEFAULT_WORDING[t] ?? 'is recognised at' },
  { key: 'event', label: 'Event line', max: 200, placeholder: () => '{conference}' },
  { key: 'seal', label: 'Seal text', max: 6, help: 'Up to 6 letters. Default: the conference acronym.', placeholder: () => 'auto' },
]

const COLOR_FIELDS: Array<{ key: ColorKey; label: string; fallback: string }> = [
  { key: 'frame', label: 'Frame and event name', fallback: '' },
  { key: 'accent', label: 'Gold accents and seal', fallback: '#B8913A' },
  { key: 'title', label: 'Title', fallback: '#1F2328' },
  { key: 'text', label: 'Body text', fallback: '#5B6168' },
  { key: 'background', label: 'Paper', fallback: '#FFFDF8' },
]

const SHOW_FIELDS: Array<{ key: ShowKey; label: string }> = [
  { key: 'logo', label: 'Conference logo' },
  { key: 'frame', label: 'Border frame' },
  { key: 'header', label: 'Top line' },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'intro', label: 'Line above the name' },
  { key: 'seal', label: 'Seal' },
  { key: 'number', label: 'Certificate number' },
  { key: 'issued', label: 'Issue date' },
  { key: 'qr', label: 'QR code (verification)' },
]

const HEX = /^#[0-9A-Fa-f]{6}$/

const EMPTY_FORM: {
  certificate_type: (typeof CERTIFICATE_TYPES)[number]
  name: string
  layout: Layout
  signatories: Signatory[]
  is_active: boolean
} = {
  certificate_type: 'participation',
  name: '',
  layout: { name: { y: 260, font_size: 48, color: '#1A1A1A' } },
  signatories: [],
  is_active: true,
}

/** Drops empty texts/colours so "empty" always means "use the default design". */
function cleanLayout(layout: Layout): Layout {
  const texts = Object.fromEntries(Object.entries(layout.texts ?? {}).filter(([, v]) => v && v.trim()))
  const colors = Object.fromEntries(Object.entries(layout.colors ?? {}).filter(([, v]) => v && HEX.test(v)))
  return {
    name: layout.name,
    ...(Object.keys(texts).length ? { texts } : {}),
    ...(Object.keys(colors).length ? { colors } : {}),
    ...(layout.show && Object.keys(layout.show).length ? { show: layout.show } : {}),
    ...(layout.font ? { font: layout.font } : {}),
  }
}

function cleanSignatories(signatories: Signatory[]): Signatory[] {
  return signatories.filter((s) => s.name.trim() || s.title.trim())
}

function EditorSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-text">
        {title}
        <ChevronDown size={16} className="text-text-muted transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-4">{children}</div>
    </details>
  )
}

function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs font-medium text-text-muted">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={HEX.test(value) ? value : fallback || '#2747A0'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-surface"
          aria-label={`${label} colour picker`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={fallback || 'Conference colour'} className="font-mono uppercase" />
      </div>
    </label>
  )
}

/** Live PDF preview of the editor's current (unsaved) settings, refreshed 500 ms after the last change. */
function LivePreview({ conferenceId, body }: { conferenceId: string; body: unknown }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(body)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const blob = await api.postBlob(`/conferences/${conferenceId}/certificate-templates/preview.pdf`, JSON.parse(key))
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not draw the preview.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
      const stale = objectUrl
      if (stale) setTimeout(() => URL.revokeObjectURL(stale), 2000)
    }
  }, [conferenceId, key])

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
        <span className="font-medium">Live preview (sample name)</span>
        {loading ? <span>Updating…</span> : null}
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <div className="relative w-full overflow-hidden rounded-md border border-border-soft bg-surface-muted" style={{ aspectRatio: '297 / 210' }}>
        {url ? (
          <iframe title="Certificate preview" src={`${url}#toolbar=0&navpanes=0&view=Fit`} className="absolute inset-0 h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-text-muted">Drawing preview…</div>
        )}
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-button hover:underline">
          Open full size
        </a>
      ) : null}
    </div>
  )
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
    const parsed = certificateTemplateSchema.safeParse({ ...form, layout: cleanLayout(form.layout), signatories: cleanSignatories(form.signatories) })
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

  const setLayout = (patch: (l: Layout) => Layout) => setForm((p) => ({ ...p, layout: patch(p.layout) }))
  const setText = (key: TextKey, value: string) => setLayout((l) => ({ ...l, texts: { ...l.texts, [key]: value } }))
  const setColor = (key: ColorKey, value: string) => setLayout((l) => ({ ...l, colors: { ...l.colors, [key]: value } }))
  const setShow = (key: ShowKey, value: boolean) => setLayout((l) => ({ ...l, show: { ...l.show, [key]: value } }))
  const setName = (patch: Partial<Layout['name']>) => setLayout((l) => ({ ...l, name: { ...l.name, ...patch } }))

  const editingTemplate = templates.find((t) => t.id === editingId) ?? null
  const previewBody = {
    certificate_type: form.certificate_type,
    layout: cleanLayout(form.layout),
    signatories: cleanSignatories(form.signatories).map(({ name, title }) => ({ name, title })),
    template_id: editingId,
  }

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

      <form onSubmit={handleSubmit} className="mt-4 rounded-lg border border-dashed border-border bg-surface-muted/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-text">{editingId ? `Edit template: ${editingTemplate?.name ?? ''}` : 'Add a template'}</p>
          <p className="text-xs text-text-muted">Leave a field empty to use the default. You can use {'{conference}'} and {'{name}'} in texts.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="space-y-3">
            <EditorSection title="Basics" defaultOpen>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Certificate type">
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
                </FormField>
                <FormField label="Template name">
                  <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Speaker 2026" />
                </FormField>
              </div>
              <Checkbox
                label="Active (one active template per type)"
                checked={form.is_active}
                onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              />
            </EditorSection>

            <EditorSection title="Text on the certificate" defaultOpen>
              {TEXT_FIELDS.map((f) => (
                <FormField key={f.key} label={f.label} help={f.help}>
                  <Input
                    value={form.layout.texts?.[f.key] ?? ''}
                    maxLength={f.max}
                    onChange={(e) => setText(f.key, e.target.value)}
                    placeholder={f.placeholder(form.certificate_type)}
                  />
                </FormField>
              ))}
            </EditorSection>

            <EditorSection title="Recipient name">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={`Font size: ${form.layout.name.font_size}`}>
                  <input
                    type="range"
                    min={20}
                    max={72}
                    value={form.layout.name.font_size}
                    onChange={(e) => setName({ font_size: Number(e.target.value) })}
                    className="w-full accent-brand"
                  />
                </FormField>
                <FormField label={`Position from top: ${form.layout.name.y}`}>
                  <input
                    type="range"
                    min={180}
                    max={330}
                    value={form.layout.name.y}
                    onChange={(e) => setName({ y: Number(e.target.value) })}
                    className="w-full accent-brand"
                  />
                </FormField>
              </div>
              <ColorField label="Name colour" value={form.layout.name.color} fallback="#1A1A1A" onChange={(v) => setName({ color: v })} />
            </EditorSection>

            <EditorSection title="Colours and font">
              <FormField label="Font">
                <Select value={form.layout.font ?? 'serif'} onChange={(e) => setLayout((l) => ({ ...l, font: e.target.value as 'serif' | 'sans' }))}>
                  <option value="serif">Classic (serif)</option>
                  <option value="sans">Modern (sans-serif)</option>
                </Select>
              </FormField>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {COLOR_FIELDS.map((c) => (
                  <ColorField key={c.key} label={c.label} value={form.layout.colors?.[c.key] ?? ''} fallback={c.fallback} onChange={(v) => setColor(c.key, v)} />
                ))}
              </div>
              <Button type="button" variant="secondary" size="sm" iconLeft={<Icon icon={RotateCcw} size={14} />} onClick={() => setLayout((l) => ({ ...l, colors: {} }))}>
                Reset colours
              </Button>
              <p className="text-xs text-text-muted">The frame uses your conference colour unless you pick one here.</p>
            </EditorSection>

            <EditorSection title="Show or hide">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SHOW_FIELDS.map((s) => (
                  <Checkbox key={s.key} label={s.label} checked={form.layout.show?.[s.key] ?? true} onChange={(e) => setShow(s.key, e.target.checked)} />
                ))}
              </div>
            </EditorSection>

            <EditorSection title="Signatories (up to 2)">
              {[0, 1].map((i) => (
                <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input value={form.signatories[i]?.name ?? ''} onChange={(e) => setSignatory(i, 'name', e.target.value)} placeholder={`Signatory ${i + 1} name`} />
                  <Input value={form.signatories[i]?.title ?? ''} onChange={(e) => setSignatory(i, 'title', e.target.value)} placeholder="Title, e.g. Conference Chair" />
                </div>
              ))}
              <p className="text-xs text-text-muted">Leave both empty to show no signature line.</p>
            </EditorSection>

            <EditorSection title="Images (background and signatures)">
              {editingTemplate ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-text-muted">Certificate background</p>
                    <p className="text-xs text-text-muted/70">PNG or JPG, A4 landscape, at least 2480 x 1754 px. Tip: hide the border frame if your image has one.</p>
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
              ) : (
                <p className="text-xs text-text-muted">Save the template first, then click Edit to upload a background or signature images.</p>
              )}
            </EditorSection>

            <div className="flex gap-2 pt-1">
              <Button type="submit" variant="primary" disabled={saving} iconLeft={<Icon icon={editingId ? Save : Plus} size={16} />}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add template'}
              </Button>
              {editingId ? (
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start">
            <LivePreview conferenceId={conferenceId} body={previewBody} />
          </div>
        </div>
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

function IssuedListSection({ conferenceId, refreshKey }: { conferenceId: string; refreshKey: number }) {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [releasing, setReleasing] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Certificate | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revoking, setRevoking] = useState(false)
  const { showToast } = useToast()

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

  async function confirmRevoke() {
    if (!revokeTarget || !revokeReason.trim()) return
    setRevoking(true)
    try {
      await api.patch(`/conferences/${conferenceId}/certificates/${revokeTarget.id}/revoke`, { reason: revokeReason.trim() })
      showToast('Certificate revoked.', 'success')
      setRevokeTarget(null)
      setRevokeReason('')
      await load()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not revoke this certificate.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setRevoking(false)
    }
  }

  async function releaseNow() {
    setReleasing(true)
    try {
      const res = await api.post<{ released: number }>(`/conferences/${conferenceId}/certificates/release-now`)
      showToast(res.released > 0 ? `Released ${res.released} certificate(s) — recipients can now download them.` : 'Nothing new to release.', 'success')
      await load()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not release certificates.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setReleasing(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-brand">Issued certificates</h2>
          <p className="text-sm text-text-muted">
            Issuing a certificate doesn't send it — "Release now" makes every issued-but-unreleased certificate downloadable and
            emails the recipient.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={releaseNow}
          disabled={releasing}
          loading={releasing}
          iconLeft={<Icon icon={Send} size={16} />}
        >
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
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setRevokeTarget(c)
                          setRevokeReason('')
                        }}
                        iconLeft={<Icon icon={Trash2} size={16} />}
                      >
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

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke this certificate?"
        message={
          <div className="space-y-3">
            <p>
              {revokeTarget?.recipient_name} will no longer be able to download their {revokeTarget ? (TYPE_LABELS[revokeTarget.certificate_type] ?? revokeTarget.certificate_type) : ''} certificate, and anyone verifying it will see it as revoked. This can't be undone.
            </p>
            <FormField label="Reason (shown in the activity log)" htmlFor="revoke-reason">
              <Input
                id="revoke-reason"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Issued to the wrong person"
                autoFocus
              />
            </FormField>
          </div>
        }
        confirmLabel="Revoke"
        confirmVariant="danger"
        busy={revoking}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}

export function CertificatesTab({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="mt-6 max-w-5xl">
      <PageHeader title="Certificates" subtitle="Design certificate templates, issue them in bulk, and release them to recipients." />
      <TemplatesSection conferenceId={conferenceId} onChanged={() => setRefreshKey((k) => k + 1)} />
      <IssueSection conferenceId={conferenceId} onIssued={() => setRefreshKey((k) => k + 1)} />
      <IssuedListSection conferenceId={conferenceId} refreshKey={refreshKey} />
    </div>
  )
}
