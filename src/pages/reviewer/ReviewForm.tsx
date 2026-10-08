import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getSubmissionFileUrl } from '../../lib/submissionFiles'
import { RECOMMENDATIONS, reviewFormSchema, type ReviewFormInput } from '../../lib/validation'
import { FILE_KIND_LABELS, RECOMMENDATION_LABELS, isImageFile } from '../../lib/submissionDisplay'

type Submission = {
  title: string
  abstract: string
  keywords: string[]
  track_id: string
}

type FileRow = {
  id: string
  file_kind: string
  version: number
  original_filename: string
  storage_path: string
  mime_type: string | null
}

type ReviewRow = {
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
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [trackName, setTrackName] = useState('')
  const [files, setFiles] = useState<FileRow[]>([])
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({})
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
    const [{ data: sub, error: subError }, { data: filesData }, { data: reviewData }] = await Promise.all([
      supabase.from('submissions').select('title, abstract, keywords, track_id').eq('id', submissionId).single(),
      supabase
        .from('submission_files')
        .select('id, file_kind, version, original_filename, storage_path, mime_type')
        .eq('submission_id', submissionId)
        .eq('status', 'active'),
      supabase.from('reviews').select('*').eq('assignment_id', assignmentId).maybeSingle(),
    ])

    if (subError) {
      setFormError(subError.message)
      setLoading(false)
      return
    }
    if (sub) {
      setSubmission(sub as Submission)
      const { data: track } = await supabase.from('conference_tracks').select('name').eq('id', sub.track_id).maybeSingle()
      setTrackName(track?.name ?? '')
    }
    setFiles((filesData ?? []) as FileRow[])

    if (reviewData) {
      const r = reviewData as ReviewRow
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
    setLoading(false)
  }, [assignmentId, submissionId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    const imageFiles = files.filter((f) => isImageFile(f.mime_type))
    if (imageFiles.length === 0) return

    async function loadPreviews() {
      const entries = await Promise.all(
        imageFiles.map(async (f) => [f.id, await getSubmissionFileUrl(f.storage_path, 1800)] as const),
      )
      if (cancelled) return
      setImagePreviews(Object.fromEntries(entries.filter(([, url]) => url)) as Record<string, string>)
    }

    loadPreviews()
    return () => {
      cancelled = true
    }
  }, [files])

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleDownload(path: string) {
    const url = await getSubmissionFileUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function persist(status: 'draft' | 'submitted') {
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
      return
    }
    setErrors({})

    const { error } = await supabase.from('reviews').upsert(
      { assignment_id: assignmentId, ...parsed.data, status },
      { onConflict: 'assignment_id' },
    )
    if (error) {
      setFormError(error.message)
      return false
    }
    return true
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

  async function handleSubmit() {
    if (!window.confirm('Submit this review? You cannot edit after submitting.')) return
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
          <p className="mt-1 text-sm text-ink/60">Track: {trackName || '—'}</p>
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
                {files.map((f) => {
                  const previewUrl = isImageFile(f.mime_type) ? imagePreviews[f.id] : undefined
                  return (
                    <li key={f.id} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span>
                          {FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} (v{f.version})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDownload(f.storage_path)}
                          className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background"
                        >
                          Download
                        </button>
                      </div>
                      {previewUrl ? (
                        <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={previewUrl}
                            alt={`${FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} preview`}
                            className="mt-2 max-h-64 rounded-md border border-line object-contain"
                          />
                        </a>
                      ) : null}
                    </li>
                  )
                })}
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
                {RECOMMENDATION_LABELS[r]}
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
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      </fieldset>
    </div>
  )
}
