import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { PageHeader, FormField, Input, Textarea, Button, Alert, Spinner } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'

/** changes-nov2, Part 4: conference-level publication information (plain text). */
export type PublicationInfo = {
  title: string | null
  publisher: string | null
  isbn_issn: string | null
  link: string | null
  date: string | null
  note: string | null
}

type FormState = Record<keyof PublicationInfo, string>
const EMPTY_FORM: FormState = { title: '', publisher: '', isbn_issn: '', link: '', date: '', note: '' }

export function PublicationInfoTab({ conferenceId }: { conferenceId: string }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<{ publication: PublicationInfo }>(`/conferences/${conferenceId}/publication-info`)
      .then((res) => {
        if (cancelled) return
        const p = res.publication
        setForm({
          title: p.title ?? '',
          publisher: p.publisher ?? '',
          isbn_issn: p.isbn_issn ?? '',
          link: p.link ?? '',
          date: p.date ? p.date.slice(0, 10) : '',
          note: p.note ?? '',
        })
      })
      .catch((err) => {
        if (!cancelled) setFormError(err instanceof ApiError ? err.message : 'Could not load the publication information.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  function update(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setErrors({})
    setSaving(true)
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]))
    try {
      await api.put(`/conferences/${conferenceId}/publication-info`, body)
      showToast('Saved.', 'success')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save this.'
      if (err instanceof ApiError && err.fields) setErrors(err.fields)
      setFormError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  return (
    <div className="mt-6 max-w-2xl">
      <PageHeader
        title="Publication information"
        subtitle="Where accepted papers are published. Shown in a Publication section on the public conference page once something is filled in."
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <FormField label="Publication title or proceedings name" htmlFor="pub-title" error={errors.title}>
          <Input id="pub-title" value={form.title} onChange={(e) => update('title', e.target.value)} maxLength={300} error={Boolean(errors.title)} />
        </FormField>

        <FormField label="Publisher" htmlFor="pub-publisher" error={errors.publisher}>
          <Input id="pub-publisher" value={form.publisher} onChange={(e) => update('publisher', e.target.value)} maxLength={300} error={Boolean(errors.publisher)} />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="ISBN or ISSN" htmlFor="pub-isbn" error={errors.isbn_issn}>
            <Input id="pub-isbn" value={form.isbn_issn} onChange={(e) => update('isbn_issn', e.target.value)} maxLength={40} error={Boolean(errors.isbn_issn)} />
          </FormField>
          <FormField label="Expected or actual publication date" htmlFor="pub-date" error={errors.date}>
            <Input id="pub-date" type="date" value={form.date} onChange={(e) => update('date', e.target.value)} error={Boolean(errors.date)} />
          </FormField>
        </div>

        <FormField
          label="DOI prefix or proceedings link"
          htmlFor="pub-link"
          error={errors.link}
          help={errors.link ? undefined : 'A DOI such as 10.1234 or a link starting with https://'}
        >
          <Input id="pub-link" value={form.link} onChange={(e) => update('link', e.target.value)} maxLength={500} error={Boolean(errors.link)} />
        </FormField>

        <FormField label="Note" htmlFor="pub-note" error={errors.note} help={errors.note ? undefined : 'For example: "Accepted papers will be published in ..."'}>
          <Textarea id="pub-note" rows={4} value={form.note} onChange={(e) => update('note', e.target.value)} maxLength={2000} />
        </FormField>

        <Button type="submit" variant="primary" disabled={saving} loading={saving} iconLeft={<Icon icon={Save} size={16} />}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </div>
  )
}
