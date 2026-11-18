import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../ui'

type Consent = { slides_allowed: boolean; paper_allowed: boolean }

/** Accepted-or-later statuses: from here the author can decide what the Audience may download. */
const CONSENT_STATUSES = ['accepted', 'full_paper_pending', 'full_paper_submitted', 'final_approved', 'scheduled', 'presented', 'completed']

/**
 * The author's choice of what registered Audience members may download once the paper is
 * final (final approved, scheduled or presented): the slides and/or the final paper. Off until
 * the author switches it on; can be changed at any time, and the next download obeys it.
 */
export function AudienceConsentCard({ conferenceId, submissionId, status }: { conferenceId: string; submissionId: string; status: string }) {
  const [consent, setConsent] = useState<Consent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const show = CONSENT_STATUSES.includes(status)

  useEffect(() => {
    if (!show) return
    let cancelled = false
    api
      .get<Consent>(`/conferences/${conferenceId}/submissions/${submissionId}/audience-consent`)
      .then((c) => !cancelled && setConsent(c))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load this setting.'))
    return () => {
      cancelled = true
    }
  }, [conferenceId, submissionId, show])

  if (!show) return null

  async function update(next: Consent) {
    const previous = consent
    setConsent(next)
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      setConsent(await api.put<Consent>(`/conferences/${conferenceId}/submissions/${submissionId}/audience-consent`, next))
      setSaved(true)
    } catch (err) {
      setConsent(previous)
      setError(err instanceof ApiError ? err.message : 'Could not save this setting.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Share with the Audience"
        subtitle="Registered Audience members can download what you allow here, once your paper is final. Change it at any time."
      />
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!consent ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <div className="space-y-1">
          <label className="flex min-h-11 items-center gap-3 text-sm text-text">
            <input type="checkbox" checked={consent.slides_allowed} disabled={saving} onChange={(e) => update({ ...consent, slides_allowed: e.target.checked })} />
            Let the Audience download my slides
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm text-text">
            <input type="checkbox" checked={consent.paper_allowed} disabled={saving} onChange={(e) => update({ ...consent, paper_allowed: e.target.checked })} />
            Let the Audience download my final paper
          </label>
          {saved ? (
            <p className="text-xs text-success" role="status">
              Saved.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  )
}
