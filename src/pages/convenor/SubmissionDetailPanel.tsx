import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { Avatar } from '../../components/Avatar'
import { downloadSubmissionFile } from '../../lib/submissionFiles'
import { assignReviewerSchema, decisionSchema, DECISIONS, DECISION_STAGES, type DecisionInput } from '../../lib/validation'
import {
  DECISION_LABELS,
  FILE_KIND_LABELS,
  RECOMMENDATION_LABELS,
  SUBMISSION_STATUS_LABELS,
} from '../../lib/submissionDisplay'
import { StatusChip } from '../../components/ui/Badge'
import { ConfirmDialog } from '../../components/ui/Modal'

type Submission = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  status: string
  current_round: number
}

type Author = {
  id: string
  full_name: string
  email: string
  is_corresponding: boolean
  user_id: string | null
  photo_path: string | null
}
type FileRow = {
  id: string
  file_kind: string
  version: number
  status: string
  original_filename: string
}

type Assignment = {
  id: string
  status: string
  due_at: string
  reviewer_id: string
  reviewer_name: string | null
  reviewer_email: string | null
  review_status: string | null
  originality: number | null
  quality: number | null
  relevance: number | null
  methodology: number | null
  overall_score: number | null
  confidence: number | null
  recommendation: string | null
  comments_to_author: string | null
  confidential_comments: string | null
}

type ReviewerOption = {
  user_id: string
  full_name: string
  email: string
  has_conflict: boolean
  already_assigned: boolean
  is_author_of_submission: boolean
}

type Decision = { id: string; stage: string; decision: string; comments_to_author: string | null; decided_at: string }

type DetailResponse = {
  submission: Submission
  authors: Author[]
  files: FileRow[]
  assignments: Assignment[]
  decisions: Decision[]
}

function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return d.toISOString().slice(0, 10)
}

export function SubmissionDetailPanel({ conferenceId, submissionId }: { conferenceId: string; submissionId: string }) {
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [authors, setAuthors] = useState<Author[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
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
  const [pendingDecision, setPendingDecision] = useState<DecisionInput | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<DetailResponse>(`/conferences/${conferenceId}/submissions/${submissionId}`)
      setSubmission(data.submission)
      setStage(data.submission.status === 'full_paper_submitted' ? 'full_paper' : 'abstract')
      setAuthors(data.authors)
      setFiles(data.files)
      setAssignments(data.assignments)
      setDecisions(data.decisions)

      const reviewersData = await api.get<{ reviewers: ReviewerOption[] }>(`/conferences/${conferenceId}/reviewers`, {
        submission_id: submissionId,
      })
      setReviewerOptions(
        reviewersData.reviewers.filter((r) => !r.has_conflict && !r.already_assigned && !r.is_author_of_submission),
      )
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this submission.')
    }
    setLoading(false)
  }, [conferenceId, submissionId])

  useEffect(() => {
    load()
  }, [load])

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    setAssignError(null)
    setNotice(null)
    const parsed = assignReviewerSchema.safeParse({ reviewer_id: reviewerId, due_at: dueAt })
    if (!parsed.success) {
      setAssignError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setAssigning(true)
    try {
      await api.post(`/conferences/${conferenceId}/submissions/${submissionId}/assignments`, {
        reviewer_id: parsed.data.reviewer_id,
        due_at: new Date(`${parsed.data.due_at}T23:59:59`).toISOString(),
      })
      setReviewerId('')
      setDueAt(defaultDueDate())
      setNotice('Reviewer assigned.')
      await load()
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not assign this reviewer.')
    }
    setAssigning(false)
  }

  function handleDownload(fileId: string) {
    downloadSubmissionFile(submissionId, fileId)
  }

  function handleDecision(e: React.FormEvent) {
    e.preventDefault()
    setDecisionError(null)
    setNotice(null)
    const parsed = decisionSchema.safeParse({ decision, stage, comments_to_author: decisionComments })
    if (!parsed.success) {
      setDecisionError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    if (!submission) return
    setPendingDecision(parsed.data)
  }

  const completedCount = assignments.filter((a) => a.review_status === 'submitted').length
  const pendingDecisionMessage = pendingDecision
    ? completedCount < assignments.length
      ? `Only ${completedCount} of ${assignments.length} assigned reviews have been submitted.`
      : "This records the convenor's decision for this stage."
    : ''

  async function confirmDecision() {
    if (!pendingDecision) return
    const parsed = pendingDecision
    setPendingDecision(null)
    setDecisionSaving(true)
    try {
      await api.post(`/conferences/${conferenceId}/submissions/${submissionId}/decisions`, {
        stage: parsed.stage,
        decision: parsed.decision,
        comments_to_author: parsed.comments_to_author,
      })
      setDecisionComments('')
      setNotice('Decision saved.')
      await load()
    } catch (err) {
      setDecisionError(err instanceof ApiError ? err.message : 'Could not save this decision.')
    }
    setDecisionSaving(false)
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
          <StatusChip status={submission.status} labels={SUBMISSION_STATUS_LABELS} />
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
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {FILE_KIND_LABELS[f.file_kind] ?? f.file_kind} · v{f.version} <span className="text-ink/50">({f.status})</span> — {f.original_filename}
                </span>
                <button type="button" onClick={() => handleDownload(f.id)} className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background">
                  Download
                </button>
              </li>
            ))}
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
                  {a.reviewer_name ?? a.reviewer_email ?? 'Reviewer'} — <span className="capitalize">{a.status.replace('_', ' ')}</span>
                </p>
                <p className="text-ink/60">Due {new Date(a.due_at).toLocaleDateString()}</p>
                {a.review_status === 'submitted' ? (
                  <div className="mt-2 space-y-1 text-ink/80">
                    <p>
                      Originality {a.originality} · Quality {a.quality} · Relevance {a.relevance} · Methodology{' '}
                      {a.methodology} · Overall {a.overall_score} · Confidence {a.confidence}
                    </p>
                    <p>Recommendation: {RECOMMENDATION_LABELS[a.recommendation ?? ''] ?? a.recommendation}</p>
                    {a.comments_to_author ? <p>To author: {a.comments_to_author}</p> : null}
                    {a.confidential_comments ? <p className="text-amber-700">Confidential: {a.confidential_comments}</p> : null}
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

      <ConfirmDialog
        open={pendingDecision !== null}
        title={
          pendingDecision
            ? `Record decision "${DECISION_LABELS[pendingDecision.decision]}" for stage "${pendingDecision.stage}"?`
            : ''
        }
        message={pendingDecisionMessage}
        confirmLabel="Save decision"
        confirmVariant="primary"
        busy={decisionSaving}
        onConfirm={confirmDecision}
        onCancel={() => setPendingDecision(null)}
      />
    </div>
  )
}
