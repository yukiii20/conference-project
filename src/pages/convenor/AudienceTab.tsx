import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Eye, EyeOff, Trash2, Upload } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu, fromKathmanduInputValue, toKathmanduInputValue } from '../../lib/datetime'
import { formatBytes } from '../../lib/audienceFiles'
import { Alert, Button, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, SkeletonText, buttonClasses } from '../../components/ui'

type Settings = {
  qa_minutes_after_end: number
  audience_feedback_closes_at: string | null
  schedule_change_emails: boolean
  audience_abstracts_enabled: boolean
  public_abstracts_enabled: boolean
}

type Material = {
  id: string
  title: string
  description: string | null
  original_filename: string
  mime_type: string
  size_bytes: number
  is_visible: boolean
  created_at: string
}

/** Convenor/manager controls for the Audience role: settings and downloadable conference materials. */
export function AudienceTab({ conferenceId }: { conferenceId: string }) {
  return (
    <div className="mt-6 space-y-8">
      <PageHeader title="Audience" subtitle="What registered Audience members can see and do, and the files they can download." />
      <AudienceSettingsForm conferenceId={conferenceId} />
      <MaterialsManager conferenceId={conferenceId} />
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-3 py-2">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="block text-xs text-text-muted">{hint}</span>
      </span>
    </label>
  )
}

function AudienceSettingsForm({ conferenceId }: { conferenceId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [closesLocal, setClosesLocal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      const { settings: s } = await api.get<{ settings: Settings }>(`/conferences/${conferenceId}/audience-settings`)
      setSettings(s)
      setClosesLocal(toKathmanduInputValue(s.audience_feedback_closes_at))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the Audience settings.')
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setSaving(true)
    setNotice(null)
    try {
      const res = await api.put<{ message: string; settings: Settings }>(`/conferences/${conferenceId}/audience-settings`, {
        ...settings,
        audience_feedback_closes_at: closesLocal ? fromKathmanduInputValue(closesLocal) : null,
      })
      setSettings(res.settings)
      setNotice({ text: res.message, error: false })
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : 'Could not save.', error: true })
    } finally {
      setSaving(false)
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!settings) return <SkeletonText lines={4} />

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-display text-base font-semibold text-text">Settings</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-sm font-medium text-text">Q&amp;A stays open after a session (minutes)</span>
          <Input
            type="number"
            min={0}
            max={1440}
            inputMode="numeric"
            value={settings.qa_minutes_after_end}
            onChange={(e) => setSettings({ ...settings, qa_minutes_after_end: Number(e.target.value) })}
            className="mt-1"
          />
          <span className="mt-1 block text-xs text-text-muted">Questions open when a session starts. 0 closes them at the end.</span>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-text">Feedback closes (Asia/Kathmandu, optional)</span>
          <Input type="datetime-local" value={closesLocal} onChange={(e) => setClosesLocal(e.target.value)} className="mt-1" />
          <span className="mt-1 block text-xs text-text-muted">After this, the Audience can no longer send or edit feedback and ratings.</span>
        </label>
      </div>
      <div className="divide-y divide-border-soft">
        <Toggle
          checked={settings.schedule_change_emails}
          onChange={(v) => setSettings({ ...settings, schedule_change_emails: v })}
          label="Email the Audience about schedule changes"
          hint="Changes are always shown in the portal. Emails are grouped, at most one every 15 minutes."
        />
        <Toggle
          checked={settings.audience_abstracts_enabled}
          onChange={(v) => setSettings({ ...settings, audience_abstracts_enabled: v })}
          label="Show accepted abstracts to the Audience"
          hint="Title, abstract, keywords, track and author names - never emails, reviews or scores."
        />
        <Toggle
          checked={settings.public_abstracts_enabled}
          onChange={(v) => setSettings({ ...settings, public_abstracts_enabled: v })}
          label="Also show accepted abstracts on the public conference page"
          hint="Anyone on the internet can then read them."
        />
      </div>
      <Button type="submit" loading={saving} className="w-full sm:w-auto">
        Save settings
      </Button>
      {notice ? (
        <p className={`text-sm ${notice.error ? 'text-danger' : 'text-success'}`} role="status">
          {notice.text}
        </p>
      ) : null}
    </form>
  )
}

function MaterialsManager({ conferenceId }: { conferenceId: string }) {
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Material | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setMaterials((await api.get<{ materials: Material[] }>(`/conferences/${conferenceId}/materials`)).materials)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the files.')
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!file) return setFormError('Choose a file to upload.')
    if (title.trim().length < 2) return setFormError('Give the file a title.')
    if (file.size > 25 * 1024 * 1024) return setFormError('The file must be 25 MB or smaller.')
    const form = new FormData()
    form.append('title', title.trim())
    if (description.trim()) form.append('description', description.trim())
    form.append('file', file)
    setUploading(true)
    try {
      await api.upload(`/conferences/${conferenceId}/materials`, form)
      setTitle('')
      setDescription('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not upload the file.')
    } finally {
      setUploading(false)
    }
  }

  async function toggle(m: Material) {
    setBusyId(m.id)
    try {
      await api.patch(`/conferences/${conferenceId}/materials/${m.id}`, { is_visible: !m.is_visible })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the file.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(m: Material) {
    setBusyId(m.id)
    try {
      await api.del(`/conferences/${conferenceId}/materials/${m.id}`)
      setConfirm(null)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the file.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-display text-base font-semibold text-text">Materials</h2>
      <p className="text-sm text-text-muted">
        Files for the Audience: programme booklet, venue map, guidelines. Papers' slides and final papers appear automatically when their
        authors allow it.
      </p>
      <form onSubmit={upload} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Venue map" aria-label="Title" maxLength={200} data-no-dirty />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description (optional)" aria-label="Description" maxLength={1000} data-no-dirty />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
          aria-label="File"
          data-no-dirty
        />
        <Button type="submit" loading={uploading} className="w-full sm:w-auto">
          <Upload aria-hidden className="h-4 w-4" /> Upload
        </Button>
        <p className="text-xs text-text-muted sm:col-span-2">PDF, Word, PowerPoint, PNG or JPG, up to 25 MB.</p>
      </form>
      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {!materials ? (
        <SkeletonText lines={3} />
      ) : materials.length === 0 ? (
        <EmptyState title="No files yet" message="Upload the first file above." />
      ) : (
        <ul className="divide-y divide-border-soft">
          {materials.map((m) => (
            <li key={m.id} className={`flex flex-wrap items-center gap-2 py-3 ${m.is_visible ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text">
                  {m.title} {m.is_visible ? null : <span className="text-xs text-text-muted">(hidden)</span>}
                </p>
                <p className="text-xs text-text-muted">
                  {m.original_filename} · {formatBytes(m.size_bytes)} · {formatKathmandu(m.created_at)}
                </p>
              </div>
              <a href={`${API_BASE}/conferences/${conferenceId}/materials/${m.id}/download`} className={buttonClasses('ghost', 'sm')}>
                <Download aria-hidden className="h-4 w-4" /> Download
              </a>
              <button type="button" className={buttonClasses('ghost', 'sm')} disabled={busyId === m.id} onClick={() => toggle(m)}>
                {m.is_visible ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
                {m.is_visible ? 'Hide' : 'Show'}
              </button>
              <button type="button" className={buttonClasses('ghost', 'sm', 'text-danger')} disabled={busyId === m.id} onClick={() => setConfirm(m)}>
                <Trash2 aria-hidden className="h-4 w-4" /> Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title="Delete this file?"
        message="The Audience can no longer download it. This is recorded in the activity log."
        confirmLabel="Delete"
        busy={busyId !== null}
        onConfirm={() => confirm && remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  )
}
