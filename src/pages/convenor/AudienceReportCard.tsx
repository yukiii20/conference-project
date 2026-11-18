import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { Card, ErrorState, SkeletonText, buttonClasses } from '../../components/ui'
import { StatTile } from '../../components/analytics/ChartPrimitives'

type Summary = {
  audience_members: number
  confirmed: number
  checked_in: number
  attended_online: number
  questions: number
  conference_feedback: number
  session_ratings: number
  certificate_eligible: number
}

/** Reports tab: Audience totals plus a per-person CSV (attendance, Q&A, feedback, certificate eligibility). */
export function AudienceReportCard({ conferenceId }: { conferenceId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSummary((await api.get<{ summary: Summary }>(`/conferences/${conferenceId}/audience-report`)).summary)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the Audience report.')
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Card>
      <p className="font-medium text-text">Audience</p>
      <p className="mt-1 text-sm text-text-muted">
        One row per Audience member: ticket, category, check-in, sessions attended (in person and online), questions, feedback and certificate
        eligibility.
      </p>
      {error ? (
        <div className="mt-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !summary ? (
        <div className="mt-3">
          <SkeletonText lines={2} />
        </div>
      ) : summary.audience_members === 0 ? (
        <p className="mt-3 text-sm text-text-muted">No Audience members yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Audience" value={String(summary.audience_members)} />
          <StatTile label="Checked in" value={String(summary.checked_in)} />
          <StatTile label="Joined online" value={String(summary.attended_online)} />
          <StatTile label="Certificate eligible" value={String(summary.certificate_eligible)} />
          <StatTile label="Questions" value={String(summary.questions)} />
          <StatTile label="Conference feedback" value={String(summary.conference_feedback)} />
          <StatTile label="Session ratings" value={String(summary.session_ratings)} />
          <StatTile label="Confirmed" value={String(summary.confirmed)} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`${API_BASE}/conferences/${conferenceId}/audience-report/export.csv`} className={buttonClasses('secondary', 'sm')}>
          Download CSV
        </a>
        <a href={`${API_BASE}/conferences/${conferenceId}/audience-report/questions.csv`} className={buttonClasses('secondary', 'sm')}>
          Questions CSV
        </a>
        <a href={`${API_BASE}/conferences/${conferenceId}/audience-feedback/export.csv`} className={buttonClasses('secondary', 'sm')}>
          Feedback and ratings CSV
        </a>
      </div>
    </Card>
  )
}
