import { useCallback, useEffect, useState } from 'react'
import { Plus, RotateCcw, Save } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../../lib/api'
import { CERTIFICATE_TYPES, certificateTemplateSchema } from '../../../lib/validation'
import { ImageUpload } from '../../../components/ImageUpload'
import { Alert, Button, Card, CardHeader, Checkbox, EmptyState, FormField, Input, Select, SkeletonText } from '../../../components/ui'
import { Icon } from '../../../components/ui/Icon'
import { COLOR_FIELDS, EMPTY_FORM, SHOW_FIELDS, TEXT_FIELDS, TYPE_LABELS, cleanLayout, cleanSignatories, type ColorKey, type Layout, type ShowKey, type Template, type TextKey } from './shared'
import { ColorField, EditorSection, LivePreview } from './editorParts'

export function TemplatesSection({ conferenceId, onChanged }: { conferenceId: string; onChanged: () => void }) {
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
