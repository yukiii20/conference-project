import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { downloadSubmissionFile } from '../../lib/submissionFiles'
import { RECOMMENDATIONS, reviewFormSchema, type ReviewFormInput } from '../../lib/validation'
import { FILE_KIND_LABELS } from '../../lib/submissionDisplay'
import { Alert, Button, Card, ConfirmDialog, FormField, Select, SkeletonText, Textarea } from '../../components/ui'

type AssignmentDetail = {
  assignment: { id: string; status: string }
  submission: { id: string; title: string; abstract: string; keywords: string[]; track_name: string }
  review_mode: string
  files: Array<{ id: string; file_kind: string; version: number; original_filename: string }>
  review: {
    originality: number | null
    quality: number | null
    relevance: number | null
    methodology: number | null
    overall_score: number | null
    confidence: number | null
    recommendation: string | null
    comments_to_author: string | null
    confidential_comments: string | null
    status: string
  } | null
}

const EMPTY_FORM = {
  originality: '3',
  quality: '3',
  relevance: '3',
  methodology: '3',
  overall_score: '3',
  confidence: '3',
  recommendation: 'minor_revision' as (typeof RECOMMENDATIONS)[number],
  comments_to_author: '',
  confidential_comments: '',
}

export function ReviewForm({ assignmentId, submissionId }: { assignmentId: string; submissionId: string }) {
  const [submission, setSubmission] = useState<AssignmentDetail['submission'] | null>(null)
  const [files, setFiles] = useState<AssignmentDetail['files']>([])
  const [reviewStatus, setReviewStatus] = useState<string>('draft')
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<AssignmentDetail>(`/reviewer/assignments/${assignmentId}`)
      setSubmission(data.submission)
      setFiles(data.files)
      if (data.review) {
        const r = data.review
        setReviewStatus(r.status)
        setForm({
          originality: String(r.originality ?? 3),
          quality: String(r.quality ?? 3),
          relevance: String(r.relevance ?? 3),
          methodology: String(r.methodology ?? 3),
          overall_score: String(r.overall_score ?? 3),
          confidence: String(r.confidence ?? 3),
          recommendation: (r.recommendation as (typeof RECOMMENDATIONS)[number]) ?? 'minor_revision',
          comments_to_author: r.comments_to_author ?? '',
          confidential_comments: r.confidential_comments ?? '',
        })
      }
      setFormError(null)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not load this assignment.')
    }
    setLoading(false)
  }, [assignmentId])

  useEffect(() => {
    load()
  }, [load])

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleDownload(fileId: string) {
    downloadSubmissionFile(submissionId, fileId)
  }

  async function persist(mode: 'draft' | 'submitted'): Promise<boolean> {
    setFormError(null)
    const parsed = reviewFormSchema.safeParse(form as ReviewFormInput)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) nextErrors[key] = issue.message
      }
      setErrors(nextErrors)
      setFormError('Fill in every field before submitting.')
      return false
    }
    setErrors({})

    try {
      if (mode === 'draft') {
        await api.put(`/reviewer/assignments/${assignmentId}/review`, parsed.data)
      } else {
        await api.post(`/reviewer/assignments/${assignmentId}/review/submit`, parsed.data)
      }
      return true
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this review.')
      return false
    }
  }

  async function handleSaveDraft() {
    setSaving(true)
    const ok = await persist('draft')
    setSaving(false)
    if (ok) {
      setSaved(true)
      await load()
    }
  }

  const [confirmingSubmit, setConfirmingSubmit] = useState(false)

  async function handleSubmit() {
    setConfirmingSubmit(false)
    setSubmitting(true)
    const ok = await persist('submitted')
    setSubmitting(false)
    if (ok) await load()
  }

  if (loading) {
    return <SkeletonText lines={4} className="mt-6" />
  }

  const locked = reviewStatus === 'submitted'

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      {saved ? <Alert variant="success">Draft saved.</Alert> : null}
      {locked ? <Alert variant="info">This review has been submitted and can no longer be edited.</Alert> : null}

      {submission ? (
        <Card>
          <h2 className="font-display text-xl font-semibold text-brand">{submission.title}</h2>
          <p className="mt-1 text-sm text-text-muted">Track: {submission.track_name || '—'}</p>
          <p className="mt-4 whitespace-pre-line text-sm text-text/80">{submission.abstract}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(submission.keywords ?? []).map((k) => (
              <span key={k} className="rounded-full bg-surface-muted px-3 py-1 text-xs text-text-muted">
                {k}
              </span>
            ))}
          </div>

          {files.length > 0 ? (
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="text-sm font-medium text-text">Files</h3>
              <ul className="mt-2 space-y-3">
                {files.map((f) => (
                  <li key={f.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span>
                        {FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} (v{f.version})
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={() => handleDownload(f.id)}>
                        Download
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      <fieldset disabled={locked} className="space-y-4 rounded-lg border border-border bg-surface p-5">
        <h3 className="font-medium text-text">Your review</h3>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {(
            [
              ['originality', 'Originality'],
              ['quality', 'Quality'],
              ['relevance', 'Relevance'],
              ['methodology', 'Methodology'],
              ['overall_score', 'Overall score'],
              ['confidence', 'Confidence'],
            ] as const
          ).map(([key, label]) => (
            <FormField key={key} label={`${label} (1-5)`} error={errors[key]}>
              <Select value={form[key]} onChange={(e) => update(key, e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </FormField>
          ))}
        </div>

        <FormField label="Recommendation">
          <Select
            value={form.recommendation}
            onChange={(e) => update('recommendation', e.target.value as (typeof RECOMMENDATIONS)[number])}
          >
            {RECOMMENDATIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Comments to author" error={errors.comments_to_author}>
          <Textarea value={form.comments_to_author} onChange={(e) => update('comments_to_author', e.target.value)} rows={5} />
        </FormField>

        <FormField label="Confidential comments to convenor" error={errors.confidential_comments}>
          <Textarea value={form.confidential_comments} onChange={(e) => update('confidential_comments', e.target.value)} rows={3} />
        </FormField>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" loading={saving} onClick={handleSaveDraft}>
            Save draft
          </Button>
          <Button type="button" loading={submitting} onClick={() => setConfirmingSubmit(true)}>
            Submit review
          </Button>
        </div>
      </fieldset>

      <ConfirmDialog
        open={confirmingSubmit}
        title="Submit this review?"
        message="You cannot edit it after submitting."
        confirmLabel="Submit review"
        confirmVariant="primary"
        busy={submitting}
        onConfirm={handleSubmit}
        onCancel={() => setConfirmingSubmit(false)}
      />
    </div>
  )
}
