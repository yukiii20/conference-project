import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { emailTemplateSchema } from '../../lib/validation'

type Template = {
  template_key: string
  subject: string
  body_html: string
  is_customized: boolean
  placeholders: string[]
}

export function EmailTemplatesTab({ conferenceId }: { conferenceId: string }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { subject: string; body_html: string }>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ templates: Template[] }>(`/conferences/${conferenceId}/email-templates`)
      setTemplates(data.templates)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load email templates.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function openEditor(t: Template) {
    setOpenKey(t.template_key)
    setEdits((prev) => ({ ...prev, [t.template_key]: { subject: t.subject, body_html: t.body_html } }))
    setPreviewHtml(null)
  }

  async function handleSave(t: Template) {
    const edit = edits[t.template_key]
    if (!edit) return
    const parsed = emailTemplateSchema.safeParse(edit)
    if (!parsed.success) {
      setRowErrors((prev) => ({ ...prev, [t.template_key]: parsed.error.issues[0]?.message ?? 'Invalid value.' }))
      return
    }
    setRowErrors((prev) => ({ ...prev, [t.template_key]: '' }))
    setBusyKey(t.template_key)
    try {
      await api.post(`/conferences/${conferenceId}/email-templates/${t.template_key}`, parsed.data)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [t.template_key]: err instanceof ApiError ? err.message : 'Could not save this.' }))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleReset(t: Template) {
    setBusyKey(t.template_key)
    try {
      await api.post(`/conferences/${conferenceId}/email-templates/${t.template_key}/reset`)
      setOpenKey(null)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [t.template_key]: err instanceof ApiError ? err.message : 'Could not reset this.' }))
    } finally {
      setBusyKey(null)
    }
  }

  async function handlePreview(t: Template) {
    try {
      const res = await api.get<{ html: string }>(`/conferences/${conferenceId}/email-templates/${t.template_key}/preview`)
      setPreviewHtml(res.html)
    } catch {
      setPreviewHtml(null)
    }
  }

  if (loading) return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  if (error) return <p className="mt-6 text-sm text-red-600">{error}</p>

  return (
    <div className="mt-6 max-w-3xl space-y-3">
      {templates.map((t) => {
        const edit = edits[t.template_key] ?? { subject: t.subject, body_html: t.body_html }
        const isOpen = openKey === t.template_key
        return (
          <div key={t.template_key} className="rounded-lg border border-line bg-white p-4">
            <button type="button" onClick={() => (isOpen ? setOpenKey(null) : openEditor(t))} className="flex w-full items-center justify-between text-left">
              <span className="font-mono text-sm text-ink">{t.template_key}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${t.is_customized ? 'bg-button/10 text-button' : 'bg-background text-ink/60'}`}>
                {t.is_customized ? 'Customised' : 'Default'}
              </span>
            </button>

            {isOpen ? (
              <div className="mt-3 space-y-3">
                {rowErrors[t.template_key] ? <p className="text-sm text-red-600">{rowErrors[t.template_key]}</p> : null}
                <p className="text-xs text-ink/50">
                  Placeholders: {t.placeholders.length > 0 ? t.placeholders.map((p) => `{{${p}}}`).join(', ') : 'none'}
                </p>
                <div>
                  <label className="block text-xs font-medium text-ink/60">Subject</label>
                  <input
                    value={edit.subject}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [t.template_key]: { ...edit, subject: e.target.value } }))}
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm focus:border-button"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/60">Body (HTML — p, br, strong, em, a, ul, ol, li, h2, h3 only)</label>
                  <textarea
                    value={edit.body_html}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [t.template_key]: { ...edit, body_html: e.target.value } }))}
                    rows={6}
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 font-mono text-xs focus:border-button"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleSave(t)} disabled={busyKey === t.template_key} className="rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                    Save
                  </button>
                  <button type="button" onClick={() => handlePreview(t)} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background">
                    Preview with sample data
                  </button>
                  {t.is_customized ? (
                    <button type="button" onClick={() => handleReset(t)} disabled={busyKey === t.template_key} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                      Reset to default
                    </button>
                  ) : null}
                </div>
                {previewHtml ? (
                  <iframe title={`${t.template_key} preview`} sandbox="" srcDoc={previewHtml} className="h-80 w-full rounded-md border border-line bg-white" />
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
