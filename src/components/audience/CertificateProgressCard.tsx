import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { certificateSteps, type CertificateProgress } from '../../lib/certificateProgress'
import { Card, ErrorState, SkeletonText, buttonClasses } from '../ui'

/**
 * "Your certificate": checked in, sessions "2 of 3", the release date, and one plain sentence
 * from the server saying what is missing or what happens next.
 */
export function CertificateProgressCard({ conferenceId, linkTo }: { conferenceId: string; linkTo?: string }) {
  const [progress, setProgress] = useState<CertificateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setProgress(await api.get<CertificateProgress>(`/conferences/${conferenceId}/audience/certificate-progress`))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server.")
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-display text-base font-semibold text-text">
        <Award aria-hidden className="h-5 w-5 text-gold" /> Your certificate
      </h2>
      {error ? (
        <div className="mt-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !progress ? (
        <div className="mt-3">
          <SkeletonText lines={3} />
        </div>
      ) : (
        <>
          <ol className="mt-3 space-y-2">
            {certificateSteps(progress).map((step) => (
              <li key={step.label} className="flex items-start gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.done ? 'bg-success text-white' : 'border border-border text-text-muted'
                  }`}
                >
                  {step.done ? '✓' : ''}
                </span>
                <span className={step.done ? 'text-text' : 'text-text-muted'}>
                  {step.label}
                  {step.detail ? <span className="block text-xs text-text-muted">{step.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          {progress.min_sessions != null ? (
            <div className="mt-3" aria-hidden="true">
              <div className="h-2 overflow-hidden rounded-full bg-page-bg">
                <div
                  className="h-full rounded-full bg-button"
                  style={{ width: `${Math.min(100, Math.round((progress.sessions_attended / Math.max(1, progress.min_sessions)) * 100))}%` }}
                />
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-sm text-text" role="status">
            {progress.message}
          </p>
          {progress.certificate && progress.certificate.status !== 'revoked' ? (
            <a
              href={`${API_BASE}/conferences/${conferenceId}/certificates/${progress.certificate.id}/download`}
              className={`${buttonClasses('primary', 'md')} mt-3 w-full sm:w-auto`}
            >
              Download certificate
            </a>
          ) : linkTo ? (
            <Link to={linkTo} className="mt-3 inline-block text-sm font-medium text-button underline-offset-4 hover:underline">
              See details
            </Link>
          ) : null}
        </>
      )}
    </Card>
  )
}
