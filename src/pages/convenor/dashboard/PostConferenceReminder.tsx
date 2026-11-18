import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { api } from '../../../lib/api'

/** changes-nov2, Part 5: dashboard card shown after the end date while no post-conference email has been sent. */
export function PostConferenceReminder({ conferenceId, base }: { conferenceId: string; base: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ reminder: boolean }>(`/conferences/${conferenceId}/post-conference-email`)
      .then((r) => {
        if (!cancelled) setShow(r.reminder)
      })
      .catch(() => {
        // No bulk-email permission or a failure: just don't show the card.
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  if (!show) return null
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-soft bg-surface p-5 shadow-card"
      data-testid="post-conference-reminder"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Mail size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-button" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">The conference has ended</h2>
          <p className="mt-0.5 text-sm text-text-muted">Send a thank-you email with links to certificates, the report, publication details and the archive.</p>
        </div>
      </div>
      <Link
        to={`${base}/communication/post-conference-email`}
        className="inline-flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:border-border-strong"
      >
        Write the email
      </Link>
    </section>
  )
}
