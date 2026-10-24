import { useCallback, useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { emailTemplateSchema } from '../../lib/validation'
import { humanizeTemplateKey } from '../../lib/humanize'
import { PageHeader, Card, Badge, Button, FormField, Input, Textarea, Alert, Spinner } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'

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

  if (loading)
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  if (error)
    return (
      <div className="mt-6">
        <Alert variant="danger">{error}</Alert>
      </div>
    )

  return (
    <div className="mt-6 max-w-3xl space-y-3">
      <PageHeader title="Email templates" subtitle="Customise the emails sent to members, authors, and reviewers." />
      {templates.map((t) => {
        const edit = edits[t.template_key] ?? { subject: t.subject, body_html: t.body_html }
        const isOpen = openKey === t.template_key
        return (
          <Card key={t.template_key}>
            <button type="button" onClick={() => (isOpen ? setOpenKey(null) : openEditor(t))} className="flex w-full items-center justify-between text-left">
              <span className="text-sm font-medium text-text">{humanizeTemplateKey(t.template_key)}</span>
              <Badge tone={t.is_customized ? 'info' : 'neutral'}>{t.is_customized ? 'Customised' : 'Default'}</Badge>
            </button>

            {isOpen ? (
              <div className="mt-3 space-y-3">
                {rowErrors[t.template_key] ? <Alert variant="danger">{rowErrors[t.template_key]}</Alert> : null}
                <p className="text-xs text-text-muted">
                  Placeholders: {t.placeholders.length > 0 ? t.placeholders.map((p) => `{{${p}}}`).join(', ') : 'none'}
                </p>
                <FormField label="Subject">
                  <Input
                    value={edit.subject}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [t.template_key]: { ...edit, subject: e.target.value } }))}
                  />
                </FormField>
                <FormField label="Body (HTML — p, br, strong, em, a, ul, ol, li, h2, h3 only)">
                  <Textarea
                    value={edit.body_html}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [t.template_key]: { ...edit, body_html: e.target.value } }))}
                    rows={6}
                    className="font-mono text-xs"
                  />
                </FormField>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSave(t)}
                    loading={busyKey === t.template_key}
                    iconLeft={<Icon icon={Save} size={16} />}
                  >
                    Save
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handlePreview(t)}>
                    Preview with sample data
                  </Button>
                  {t.is_customized ? (
                    <Button variant="danger" size="sm" onClick={() => handleReset(t)} loading={busyKey === t.template_key}>
                      Reset to default
                    </Button>
                  ) : null}
                </div>
                {previewHtml ? (
                  <iframe title={`${humanizeTemplateKey(t.template_key)} preview`} sandbox="" srcDoc={previewHtml} className="h-80 w-full rounded-md border border-border bg-surface" />
                ) : null}
              </div>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}
