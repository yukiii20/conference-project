import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Avatar } from '../../components/Avatar'
import { getSubmissionFileUrl } from '../../lib/submissionFiles'
import { sendQueuedEmails } from '../../lib/sendQueuedEmails'
import { assignReviewerSchema, decisionSchema, DECISIONS, DECISION_STAGES } from '../../lib/validation'
import {
  DECISION_LABELS,
  FILE_KIND_LABELS,
  RECOMMENDATION_LABELS,
  SUBMISSION_STATUS_LABELS,
  isImageFile,
  statusBadgeClass,
} from '../../lib/submissionDisplay'

type Submission = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  status: string
  current_round: number
  created_by: string
}

type Author = {
  id: string
  full_name: string
  email: string
  is_corresponding: boolean
  user_id: string | null
  photo_path?: string | null
}
type FileRow = {
  id: string
  file_kind: string
  version: number
  status: string
  original_filename: string
  storage_path: string
  mime_type: string | null
}

type Assignment = {
  id: string
  status: string
  due_at: string
  reviewer_id: string
  reviewer: { full_name: string | null; email: string | null } | null
  review: {
    status: string
    originality: number | null
    quality: number | null
    relevance: number | null
    methodology: number | null
    overall_score: number | null
    confidence: number | null
    recommendation: string | null
    comments_to_author: string | null
    confidential_comments: string | null
  } | null
}

type ReviewerOption = { user_id: string; full_name: string | null; email: string | null }

type Decision = { id: string; stage: string; decision: string; comments_to_author: string | null; decided_at: string }

function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return d.toISOString().slice(0, 10)
}

export function SubmissionDetailPanel({ conferenceId, submissionId }: { conferenceId: string; submissionId: string }) {
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [authors, setAuthors] = useState<Author[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({})
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [reviewerOptions, setReviewerOptions] = useState<ReviewerOption[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [reviewerId, setReviewerId] = useState('')
  const [dueAt, setDueAt] = useState(defaultDueDate())
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)

  const [decision, setDecision] = useState<(typeof DECISIONS)[number]>('accepted')
  const [stage, setStage] = useState<(typeof DECISION_STAGES)[number]>('abstract')
  const [decisionComments, setDecisionComments] = useState('')
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [decisionSaving, setDecisionSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: sub, error: subError } = await supabase
      .from('submissions')
      .select('id, submission_code, title, abstract, keywords, status, current_round, created_by')
      .eq('id', submissionId)
      .single()

    if (subError || !sub) {
      setError(subError?.message ?? 'Submission not found.')
      setLoading(false)
      return
    }
    setSubmission(sub as Submission)
    setStage(sub.status === 'full_paper_pending' || sub.status === 'full_paper_submitted' ? 'full_paper' : 'abstract')

    const [{ data: authorsData }, { data: filesData }, { data: assignData }, { data: membersData }, { data: decisionsData }] =
      await Promise.all([
        supabase.from('submission_authors').select('id, full_name, email, is_corresponding, user_id').eq('submission_id', submissionId).order('author_order'),
        supabase
          .from('submission_files')
          .select('id, file_kind, version, status, original_filename, storage_path, mime_type')
          .eq('submission_id', submissionId)
          .order('file_kind')
          .order('version', { ascending: false }),
        supabase
          .from('review_assignments')
          .select('id, status, due_at, reviewer_id, reviewer:profiles!review_assignments_reviewer_id_fkey(full_name, email), review:reviews(status, originality, quality, relevance, methodology, overall_score, confidence, recommendation, comments_to_author, confidential_comments)')
          .eq('submission_id', submissionId)
          .order('assigned_at'),
        supabase
          .from('conference_members')
          .select('user_id, profiles!conference_members_user_id_fkey(full_name, email)')
          .eq('conference_id', conferenceId)
          .eq('role_code', 'reviewer')
          .eq('status', 'active'),
        supabase.from('submission_decisions').select('id, stage, decision, comments_to_author, decided_at').eq('submission_id', submissionId).order('decided_at', { ascending: false }),
      ])

    const authorRows = (authorsData ?? []) as Author[]
    const authorAccountIds = authorRows.map((a) => a.user_id).filter((id): id is string => Boolean(id))
    if (authorAccountIds.length > 0) {
      const { data: photoRows } = await supabase.from('profiles').select('id, photo_path').in('id', authorAccountIds)
      const photoById = new Map((photoRows ?? []).map((p) => [p.id, p.photo_path]))
      for (const a of authorRows) {
        if (a.user_id) a.photo_path = photoById.get(a.user_id) ?? null
      }
    }
    setAuthors(authorRows)
    setFiles((filesData ?? []) as FileRow[])
    setAssignments(
      ((assignData ?? []) as unknown[]).map((a) => a as Assignment),
    )

    const authorUserIds = new Set(((authorsData ?? []) as Author[]).map((a) => a.user_id).filter(Boolean))
    const options = ((membersData ?? []) as unknown as Array<{ user_id: string; profiles: ReviewerOption | null }>)
      .filter((m) => m.user_id !== sub.created_by && !authorUserIds.has(m.user_id))
      .map((m) => ({ user_id: m.user_id, full_name: m.profiles?.full_name ?? null, email: m.profiles?.email ?? null }))
    setReviewerOptions(options)

    setDecisions((decisionsData ?? []) as Decision[])
    setError(null)
    setLoading(false)
  }, [conferenceId, submissionId])

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

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    setAssignError(null)
    setNotice(null)
    const parsed = assignReviewerSchema.safeParse({ reviewer_id: reviewerId, due_at: dueAt })
    if (!parsed.success) {
      setAssignError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    if (!submission) return
    setAssigning(true)
    const { error: assignErr } = await supabase.from('review_assignments').insert({
      conference_id: conferenceId,
      submission_id: submissionId,
      reviewer_id: parsed.data.reviewer_id,
      due_at: new Date(`${parsed.data.due_at}T23:59:59`).toISOString(),
      round: submission.current_round,
    })
    setAssigning(false)
    if (assignErr) {
      setAssignError(assignErr.message)
      return
    }
    setReviewerId('')
    setDueAt(defaultDueDate())
    const emailOk = await sendQueuedEmails()
    setNotice(emailOk ? 'Reviewer assigned.' : 'Reviewer assigned. Email will be retried.')
    await load()
  }

  async function handleDownload(path: string) {
    const url = await getSubmissionFileUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function handleDecision(e: React.FormEvent) {
    e.preventDefault()
    setDecisionError(null)
    setNotice(null)
    const parsed = decisionSchema.safeParse({ decision, stage, comments_to_author: decisionComments })
    if (!parsed.success) {
      setDecisionError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    if (!submission) return
    if (!window.confirm(`Record decision "${DECISION_LABELS[parsed.data.decision]}" for stage "${parsed.data.stage}"?`)) return

    setDecisionSaving(true)
    const { error: saveError } = await supabase.from('submission_decisions').insert({
      submission_id: submissionId,
      stage: parsed.data.stage,
      decision: parsed.data.decision,
      comments_to_author: parsed.data.comments_to_author,
      round: submission.current_round,
    })
    setDecisionSaving(false)
    if (saveError) {
      setDecisionError(saveError.message)
      return
    }
    setDecisionComments('')
    const emailOk = await sendQueuedEmails()
    setNotice(emailOk ? 'Decision saved.' : 'Decision saved. Email will be retried.')
    await load()
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  if (error || !submission) {
    return <p className="mt-6 text-sm text-red-600">{error}</p>
  }

  return (
    <div className="mt-4 max-w-4xl space-y-6">
      {notice ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      ) : null}

      <div className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          {submission.submission_code ? <span className="font-mono text-sm text-ink/60">{submission.submission_code}</span> : null}
          <span className={statusBadgeClass(submission.status)}>{SUBMISSION_STATUS_LABELS[submission.status] ?? submission.status}</span>
        </div>
        <h2 className="mt-2 text-lg font-semibold text-ink">{submission.title}</h2>
        <p className="mt-3 whitespace-pre-line text-sm text-ink/80">{submission.abstract}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(submission.keywords ?? []).map((k) => (
            <span key={k} className="rounded-full bg-background px-3 py-1 text-xs text-ink/70">
              {k}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-5">
        <h3 className="font-medium text-ink">Authors</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {authors.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-ink/80">
              <Avatar photoPath={a.photo_path} name={a.full_name} size="h-7 w-7" />
              {a.full_name} ({a.email}){a.is_corresponding ? <span className="ml-1 text-xs text-button">corresponding</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-line bg-white p-5">
        <h3 className="font-medium text-ink">Files</h3>
        {files.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">No files uploaded.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {files.map((f) => {
              const previewUrl = isImageFile(f.mime_type) ? imagePreviews[f.id] : undefined
              return (
                <li key={f.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      {FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} · v{f.version} <span className="text-ink/50">({f.status})</span> — {f.original_filename}
                    </span>
                    <button type="button" onClick={() => handleDownload(f.storage_path)} className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background">
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
        )}
      </div>

      <div className="rounded-lg border border-line bg-white p-5">
        <h3 className="font-medium text-ink">Reviewers</h3>
        {assignments.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">No reviewers assigned yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {assignments.map((a) => (
              <li key={a.id} className="rounded-md border border-line p-3 text-sm">
                <p className="font-medium text-ink">
                  {a.reviewer?.full_name ?? a.reviewer?.email ?? 'Reviewer'} — <span className="capitalize">{a.status.replace('_', ' ')}</span>
                </p>
                <p className="text-ink/60">Due {new Date(a.due_at).toLocaleDateString()}</p>
                {a.review && a.review.status === 'submitted' ? (
                  <div className="mt-2 space-y-1 text-ink/80">
                    <p>
                      Originality {a.review.originality} · Quality {a.review.quality} · Relevance {a.review.relevance} · Methodology{' '}
                      {a.review.methodology} · Overall {a.review.overall_score} · Confidence {a.review.confidence}
                    </p>
                    <p>Recommendation: {RECOMMENDATION_LABELS[a.review.recommendation ?? ''] ?? a.review.recommendation}</p>
                    {a.review.comments_to_author ? <p>To author: {a.review.comments_to_author}</p> : null}
                    {a.review.confidential_comments ? <p className="text-amber-700">Confidential: {a.review.confidential_comments}</p> : null}
                  </div>
                ) : (
                  <p className="mt-1 text-ink/50">No submitted review yet.</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAssign} className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-line p-3">
          {assignError ? <p className="w-full text-sm text-red-600">{assignError}</p> : null}
          <div>
            <label className="block text-xs font-medium text-ink/60">Reviewer</label>
            <select
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
              className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
            >
              <option value="">Choose a reviewer</option>
              {reviewerOptions.map((r) => (
                <option key={r.user_id} value={r.user_id}>
                  {r.full_name ?? r.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/60">Due date</label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1 rounded-md border border-line px-3 py-2 text-sm focus:border-button"
            />
          </div>
          <button
            type="submit"
            disabled={assigning}
            className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {assigning ? 'Assigning…' : 'Assign reviewer'}
          </button>
        </form>
      </div>

      {decisions.length > 0 ? (
        <div className="rounded-lg border border-line bg-white p-5">
          <h3 className="font-medium text-ink">Decision history</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {decisions.map((d) => (
              <li key={d.id} className="text-ink/70">
                <span className="font-medium text-ink capitalize">
                  {d.stage.replace('_', ' ')}: {DECISION_LABELS[d.decision] ?? d.decision}
                </span>{' '}
                — {new Date(d.decided_at).toLocaleString()}
                {d.comments_to_author ? <span className="block text-ink/60">{d.comments_to_author}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={handleDecision} className="rounded-lg border border-line bg-white p-5">
        <h3 className="font-medium text-ink">Record a decision</h3>
        {decisionError ? <p className="mt-2 text-sm text-red-600">{decisionError}</p> : null}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink/60">Stage</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as (typeof DECISION_STAGES)[number])}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm capitalize focus:border-button"
            >
              {DECISION_STAGES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/60">Decision</label>
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as (typeof DECISIONS)[number])}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
            >
              {DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {DECISION_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs font-medium text-ink/60">Comments to author</label>
          <textarea
            value={decisionComments}
            onChange={(e) => setDecisionComments(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm focus:border-button"
          />
        </div>

        <button
          type="submit"
          disabled={decisionSaving}
          className="mt-3 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {decisionSaving ? 'Saving…' : 'Save decision'}
        </button>
      </form>
    </div>
  )
}
