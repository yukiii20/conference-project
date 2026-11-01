import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { Alert } from '../../../components/ui'
import { type Warnings } from './shared'

export function WarningsPanel({ conferenceId, refreshKey }: { conferenceId: string; refreshKey: number }) {
  const [warnings, setWarnings] = useState<Warnings | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<Warnings>(`/conferences/${conferenceId}/sessions/warnings`)
      .then((data) => {
        if (!cancelled) setWarnings(data)
      })
      .catch(() => {
        if (!cancelled) setWarnings(null)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId, refreshKey])

  if (!warnings) return null
  const total = warnings.unscheduled_papers.length + warnings.sessions_without_chair.length
  if (total === 0) return null

  return (
    <div className="mb-6">
      <Alert variant="warning">
        <p className="font-medium">Needs attention</p>
        {warnings.unscheduled_papers.length > 0 ? (
          <p className="mt-1">
            {warnings.unscheduled_papers.length} accepted paper{warnings.unscheduled_papers.length === 1 ? '' : 's'} not
            yet scheduled: {warnings.unscheduled_papers.map((p) => p.title).join(', ')}
          </p>
        ) : null}
        {warnings.sessions_without_chair.length > 0 ? (
          <p className="mt-1">
            {warnings.sessions_without_chair.length} published session{warnings.sessions_without_chair.length === 1 ? '' : 's'} with
            no chair: {warnings.sessions_without_chair.map((s) => s.title).join(', ')}
          </p>
        ) : null}
      </Alert>
    </div>
  )
}
