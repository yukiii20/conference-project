import { useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Alert, Badge, Button, Card, CardHeader, Checkbox, FormField, Input, PageHeader, Spinner, TableContainer } from '../../components/ui'

type ProposedAssignment = {
  submission_id: string
  submission_title: string
  submission_code: string | null
  reviewer_id: string
  reviewer_name: string
  reason: string
}
type ReviewerLoad = { reviewer_id: string; reviewer_name: string; assigned_count: number; total_load: number }
type Warning = { submission_id: string; submission_title: string; submission_code: string | null; message: string }
type PreviewResponse = {
  papers_considered: number
  assignments: ProposedAssignment[]
  reviewer_loads: ReviewerLoad[]
  warnings: Warning[]
}

function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return d.toISOString().slice(0, 10)
}

export function AutoAssignTab({ conferenceId }: { conferenceId: string }) {
  const [reviewersPerPaper, setReviewersPerPaper] = useState(3)
  const [maxPapersPerReviewer, setMaxPapersPerReviewer] = useState(5)
  const [onlyUnassigned, setOnlyUnassigned] = useState(true)
  const [dueAt, setDueAt] = useState(defaultDueDate())

  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  function keyOf(a: { submission_id: string; reviewer_id: string }) {
    return `${a.submission_id}:${a.reviewer_id}`
  }

  async function handlePreview() {
    setPreviewing(true)
    setError(null)
    try {
      const data = await api.post<PreviewResponse>(`/conferences/${conferenceId}/auto-assign/preview`, {
        reviewers_per_paper: reviewersPerPaper,
        max_papers_per_reviewer: maxPapersPerReviewer,
        only_unassigned: onlyUnassigned,
      })
      setPreview(data)
      setRemovedKeys(new Set())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build a preview.')
    }
    setPreviewing(false)
  }

  async function handleConfirm() {
    if (!preview) return
    const assignments = preview.assignments.filter((a) => !removedKeys.has(keyOf(a))).map((a) => ({ submission_id: a.submission_id, reviewer_id: a.reviewer_id }))
    if (assignments.length === 0) {
      showToast('Nothing to confirm.', 'error')
      return
    }
    setConfirming(true)
    try {
      const res = await api.post<{ count: number }>(`/conferences/${conferenceId}/auto-assign/confirm`, { due_at: dueAt, assignments })
      showToast(`${res.count} review assignment${res.count === 1 ? '' : 's'} created.`, 'success')
      setPreview(null)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not confirm these assignments.', 'error')
    }
    setConfirming(false)
  }

  const activeAssignments = preview?.assignments.filter((a) => !removedKeys.has(keyOf(a))) ?? []

  return (
    <div className="mt-6 max-w-4xl">
      <PageHeader title="Auto-assign reviewers" subtitle="Propose reviewer assignments for every eligible paper, review them, then confirm." />
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Reviewers per paper">
            <Input
              type="number"
              min={1}
              max={10}
              value={reviewersPerPaper}
              onChange={(e) => setReviewersPerPaper(Number(e.target.value))}
              className="w-24"
            />
          </FormField>
          <FormField label="Max papers per reviewer">
            <Input
              type="number"
              min={1}
              max={50}
              value={maxPapersPerReviewer}
              onChange={(e) => setMaxPapersPerReviewer(Number(e.target.value))}
              className="w-24"
            />
          </FormField>
          <FormField label="Due date">
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="w-40" />
          </FormField>
          <Checkbox
            label="Only papers with no reviewer yet"
            checked={onlyUnassigned}
            onChange={(e) => setOnlyUnassigned(e.target.checked)}
          />
          <Button type="button" variant="primary" onClick={handlePreview} loading={previewing}>
            {previewing ? 'Building preview…' : 'Preview'}
          </Button>
        </div>
      </Card>

      {preview ? (
        <>
          <p className="mt-4 text-sm text-text-muted">
            Considered {preview.papers_considered} paper{preview.papers_considered === 1 ? '' : 's'}. Nothing is saved
            until you confirm below.
          </p>

          {preview.warnings.length > 0 ? (
            <div className="mt-3">
              <Alert variant="warning">
                <ul className="list-disc space-y-1 pl-4">
                  {preview.warnings.map((w) => (
                    <li key={w.submission_id}>
                      {w.submission_title} ({w.submission_code ?? '—'}): {w.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          ) : null}

          <Card className="mt-4">
            <CardHeader title="Proposed assignments" />
            {activeAssignments.length === 0 ? (
              <p className="text-sm text-text-muted">No proposed assignments (remove some above, or run a new preview).</p>
            ) : (
              <TableContainer minWidth={720}>
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-text-muted">
                    <th className="px-4 py-2 font-medium">Paper</th>
                    <th className="px-4 py-2 font-medium">Proposed reviewer</th>
                    <th className="px-4 py-2 font-medium">Reason</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.assignments.map((a) => {
                    const key = keyOf(a)
                    const removed = removedKeys.has(key)
                    return (
                      <tr key={key} className={removed ? 'opacity-40' : undefined}>
                        <td className="px-4 py-3">
                          {a.submission_title} <Badge>{a.submission_code ?? '—'}</Badge>
                        </td>
                        <td className="px-4 py-3">{a.reviewer_name}</td>
                        <td className="px-4 py-3 text-text-muted">{a.reason}</td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            onClick={() =>
                              setRemovedKeys((prev) => {
                                const next = new Set(prev)
                                if (removed) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }
                          >
                            {removed ? 'Undo' : 'Remove'}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </TableContainer>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader title="Reviewer load after this run" />
            {preview.reviewer_loads.length === 0 ? (
              <p className="text-sm text-text-muted">No active reviewers in this conference yet.</p>
            ) : (
              <TableContainer minWidth={480}>
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-text-muted">
                    <th className="px-4 py-2 font-medium">Reviewer</th>
                    <th className="px-4 py-2 font-medium">New papers</th>
                    <th className="px-4 py-2 font-medium">Total load</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.reviewer_loads.map((l) => (
                    <tr key={l.reviewer_id}>
                      <td className="px-4 py-3">{l.reviewer_name}</td>
                      <td className="px-4 py-3">{l.assigned_count}</td>
                      <td className="px-4 py-3">{l.total_load}</td>
                    </tr>
                  ))}
                </tbody>
              </TableContainer>
            )}
          </Card>

          <div className="mt-4">
            <Button type="button" variant="primary" onClick={handleConfirm} loading={confirming} disabled={activeAssignments.length === 0}>
              {confirming ? 'Confirming…' : `Confirm ${activeAssignments.length} assignment${activeAssignments.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
