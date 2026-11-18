import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Alert, Button, Card, CardHeader, ConfirmDialog, FormField, Input } from '../../components/ui'

/** changes-nov2, Part 4: one paper's publication record (Papers -> submission -> Publication). */
type Publication = {
  is_published: boolean
  published_in: string | null
  doi_or_link: string | null
  publication_date: string | null
  publishable: boolean
}

export function PaperPublicationCard({ conferenceId, submissionId }: { conferenceId: string; submissionId: string }) {
  const [pub, setPub] = useState<Publication | null>(null)
  const [form, setForm] = useState({ is_published: false, published_in: '', doi_or_link: '', publication_date: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false
    api
      .get<{ publication: Publication }>(`/conferences/${conferenceId}/submissions/${submissionId}/publication`)
      .then((res) => {
        if (cancelled) return
        setPub(res.publication)
        setForm({
          is_published: res.publication.is_published,
          published_in: res.publication.published_in ?? '',
          doi_or_link: res.publication.doi_or_link ?? '',
          publication_date: res.publication.publication_date?.slice(0, 10) ?? '',
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the publication.')
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId, submissionId])

  async function save() {
    setSaving(true)
    setError(null)
    setErrors({})
    try {
      await api.put(`/conferences/${conferenceId}/submissions/${submissionId}/publication`, {
        is_published: form.is_published,
        published_in: form.published_in.trim() || null,
        doi_or_link: form.doi_or_link.trim() || null,
        publication_date: form.publication_date || null,
      })
      showToast('Publication saved.', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields)
      setError(err instanceof ApiError ? err.message : 'Could not save the publication.')
    } finally {
      setSaving(false)
    }
  }

  if (!pub) return error ? <Alert variant="danger">{error}</Alert> : null

  return (
    <Card>
      <CardHeader title="Publication" />
      {!pub.publishable ? (
        <p className="text-sm text-text-muted">A paper can be published once it is final approved.</p>
      ) : (
        <div className="space-y-4" data-testid="paper-publication">
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <label className="flex items-center gap-2 text-sm font-medium text-text">
            <input
              type="checkbox"
              role="switch"
              aria-checked={form.is_published}
              checked={form.is_published}
              onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
              className="h-4 w-4 accent-[var(--color-button)]"
            />
            Published
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Published in" htmlFor="pp-in" error={errors.published_in}>
              <Input id="pp-in" value={form.published_in} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, published_in: e.target.value }))} />
            </FormField>
            <FormField label="Publication date" htmlFor="pp-date" error={errors.publication_date}>
              <Input id="pp-date" type="date" value={form.publication_date} onChange={(e) => setForm((f) => ({ ...f, publication_date: e.target.value }))} />
            </FormField>
          </div>
          <FormField label="DOI or link (optional)" htmlFor="pp-doi" error={errors.doi_or_link}>
            <Input id="pp-doi" value={form.doi_or_link} maxLength={500} placeholder="10.1234/abc or https://…" onChange={(e) => setForm((f) => ({ ...f, doi_or_link: e.target.value }))} />
          </FormField>
          <Button type="button" onClick={save} loading={saving}>
            Save publication
          </Button>
        </div>
      )}
    </Card>
  )
}

/** Bulk action on the Papers list: marks every final-approved (or later) paper as published, after a warning. */
export function PublishAllPapersButton({ conferenceId, onDone }: { conferenceId: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { showToast } = useToast()

  async function publishAll() {
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>(`/conferences/${conferenceId}/paper-publications/publish-all`, {})
      showToast(res.message, 'success')
      setOpen(false)
      onDone?.()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not publish the papers.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Publish all final-approved papers
      </Button>
      <ConfirmDialog
        open={open}
        title="Publish all final-approved papers?"
        message="Every final-approved, scheduled, presented or completed paper will be marked as Published, and its full paper becomes downloadable in the public archive after the conference. Make sure the authors agreed to publication first."
        confirmLabel="Publish all"
        confirmVariant="primary"
        busy={busy}
        onConfirm={publishAll}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}
