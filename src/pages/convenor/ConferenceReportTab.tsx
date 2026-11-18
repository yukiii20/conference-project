import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Save, Upload } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { useToast } from '../../components/ui/Toast'
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, FormField, PageHeader, Spinner, Textarea } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'

/** changes-nov2, Part 3: Communication -> Conference report (text and/or PDF, publish/unpublish). */
type Report = {
  body_text: string | null
  pdf_original_name: string | null
  has_pdf: boolean
  is_published: boolean
  published_at: string | null
  published_by_name: string | null
  updated_at: string | null
}

const MAX_CHARS = 20000

export function ConferenceReportTab({ conferenceId }: { conferenceId: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'upload' | 'publish' | 'remove' | null>(null)
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | null>(null)
  const [preview, setPreview] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ report: Report }>(`/conferences/${conferenceId}/conference-report`)
      setReport(res.report)
      setText(res.report.body_text ?? '')
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the report.')
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<{ message?: string } | unknown>, success: string) {
    setBusy(kind)
    setError(null)
    try {
      await action()
      showToast(success, 'success')
      await load()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(null)
    }
  }

  function save() {
    return run('save', () => api.put(`/conferences/${conferenceId}/conference-report`, { body_text: text.trim() || null }), 'Report saved.')
  }

  function upload(file: File) {
    const form = new FormData()
    form.append('file', file)
    return run('upload', () => api.upload(`/conferences/${conferenceId}/conference-report/pdf`, form), 'PDF uploaded.')
  }

  if (!report) {
    return error ? (
      <div className="mt-6">
        <Alert variant="danger">{error}</Alert>
      </div>
    ) : (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  const dirty = (report.body_text ?? '') !== text

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <PageHeader
        title="Conference report"
        subtitle="A report on the conference, shown in the Archive section of the public conference page once you publish it."
      />
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={report.is_published ? 'success' : 'neutral'}>{report.is_published ? 'Published' : 'Not published'}</Badge>
            {report.is_published && report.published_at ? (
              <span className="text-sm text-text-muted">
                {formatKathmandu(report.published_at)}
                {report.published_by_name ? ` by ${report.published_by_name}` : ''}
              </span>
            ) : null}
          </div>
          {report.is_published ? (
            <Button type="button" variant="secondary" loading={busy === 'publish'} onClick={() => setConfirm('unpublish')}>
              Unpublish
            </Button>
          ) : (
            <Button type="button" loading={busy === 'publish'} disabled={dirty} onClick={() => setConfirm('publish')}>
              Publish
            </Button>
          )}
        </div>
        {dirty && !report.is_published ? <p className="mt-2 text-xs text-text-muted">Save your changes before publishing.</p> : null}
      </Card>

      <Card>
        <CardHeader title="Report text" />
        <FormField label="Report (plain text)" htmlFor="report-text" help={`${text.length.toLocaleString()} / ${MAX_CHARS.toLocaleString()} characters`}>
          <Textarea id="report-text" rows={12} value={text} maxLength={MAX_CHARS} onChange={(e) => setText(e.target.value)} />
        </FormField>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" loading={busy === 'save'} disabled={!dirty} onClick={save} iconLeft={<Icon icon={Save} size={16} />}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={() => setPreview((v) => !v)}>
            {preview ? 'Hide preview' : 'Preview'}
          </Button>
        </div>
        {preview ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4" data-testid="report-preview">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Preview - as shown in the Archive</p>
            {text.trim() ? <p className="whitespace-pre-line text-sm leading-relaxed text-text">{text.trim()}</p> : <p className="text-sm text-text-muted">No text yet.</p>}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Report PDF (optional)" />
        {report.has_pdf ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Icon icon={FileText} size={16} />
            <a href={`${API_BASE}/conferences/${conferenceId}/conference-report/pdf`} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo hover:underline">
              {report.pdf_original_name ?? 'conference-report.pdf'}
            </a>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={busy === 'remove'}
              onClick={() => run('remove', () => api.del(`/conferences/${conferenceId}/conference-report/pdf`), 'PDF removed.')}
            >
              Remove
            </Button>
          </div>
        ) : (
          <p className="text-sm text-text-muted">No PDF uploaded.</p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label="Upload report PDF"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) upload(f)
          }}
        />
        <Button type="button" variant="secondary" className="mt-3" loading={busy === 'upload'} onClick={() => fileRef.current?.click()} iconLeft={<Icon icon={Upload} size={16} />}>
          {report.has_pdf ? 'Replace PDF' : 'Upload PDF'}
        </Button>
        <p className="mt-2 text-xs text-text-muted">PDF only, up to 20 MB.</p>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'publish' ? 'Publish the conference report?' : 'Unpublish the conference report?'}
        message={
          confirm === 'publish'
            ? 'Everyone will see the report in the Archive section of the public conference page.'
            : 'The report will no longer be shown on the public conference page.'
        }
        confirmLabel={confirm === 'publish' ? 'Publish' : 'Unpublish'}
        confirmVariant="primary"
        busy={busy === 'publish'}
        onConfirm={() => {
          const action = confirm
          setConfirm(null)
          run('publish', () => api.post(`/conferences/${conferenceId}/conference-report/${action}`, {}), action === 'publish' ? 'Report published.' : 'Report unpublished.')
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
