import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { downloadSubmissionFile } from '../../lib/submissionFiles'
import { RECOMMENDATIONS, reviewFormSchema, type ReviewFormInput } from '../../lib/validation'
import { FILE_KIND_LABELS } from '../../lib/submissionDisplay'
import { ConfirmDialog } from '../../components/ui/Modal'

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
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  const locked = reviewStatus === 'submitted'

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      {formError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {formError}
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Draft saved.</div>
      ) : null}
      {locked ? (
        <div className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink/70">
          This review has been submitted and can no longer be edited.
        </div>
      ) : null}

      {submission ? (
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="text-lg font-semibold text-ink">{submission.title}</h2>
          <p className="mt-1 text-sm text-ink/60">Track: {submission.track_name || '—'}</p>
          <p className="mt-4 whitespace-pre-line text-sm text-ink/80">{submission.abstract}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(submission.keywords ?? []).map((k) => (
              <span key={k} className="rounded-full bg-background px-3 py-1 text-xs text-ink/70">
                {k}
              </span>
            ))}
          </div>

          {files.length > 0 ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-sm font-medium text-ink">Files</h3>
              <ul className="mt-2 space-y-3">
                {files.map((f) => (
                  <li key={f.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span>
                        {FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} (v{f.version})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDownload(f.id)}
                        className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background"
                      >
                        Download
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <fieldset disabled={locked} className="space-y-4 rounded-lg border border-line bg-white p-5">
        <h3 className="font-medium text-ink">Your review</h3>

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
            <div key={key}>
              <label className="block text-xs font-medium text-ink/60">{label} (1-5)</label>
              <select
                value={form[key]}
                onChange={(e) => update(key, e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2 text-sm focus:border-button"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {errors[key] ? <p className="mt-1 text-xs text-red-600">{errors[key]}</p> : null}
            </div>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-ink">Recommendation</label>
          <select
            value={form.recommendation}
            onChange={(e) => update('recommendation', e.target.value as (typeof RECOMMENDATIONS)[number])}
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 focus:border-button"
          >
            {RECOMMENDATIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink">Comments to author</label>
          <textarea
            value={form.comments_to_author}
            onChange={(e) => update('comments_to_author', e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.comments_to_author ? <p className="mt-1 text-sm text-red-600">{errors.comments_to_author}</p> : null}
        </div>

        <div>
          <label className="block text-sm font-medium text-ink">Confidential comments to convenor</label>
          <textarea
            value={form.confidential_comments}
            onChange={(e) => update('confidential_comments', e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.confidential_comments ? <p className="mt-1 text-sm text-red-600">{errors.confidential_comments}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saving}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingSubmit(true)}
            disabled={submitting}
            className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit review'}
          </button>
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
