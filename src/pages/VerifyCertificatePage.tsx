import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { formatKathmandu } from '../lib/datetime'

type VerifyResult = {
  valid: boolean
  status: string
  recipient_name: string
  certificate_type: string
  conference_name: string
  issued_at: string
} | null

const TYPE_LABELS: Record<string, string> = {
  participation: 'Participation',
  presentation: 'Presentation',
  speaker: 'Speaker',
  reviewer: 'Reviewer',
  session_chair: 'Session chair',
  staff: 'Staff',
  best_paper: 'Best paper',
}

/** No login required — anyone with the link can check a certificate's authenticity. */
export function VerifyCertificatePage() {
  const { token } = useParams<{ token: string }>()
  const [result, setResult] = useState<VerifyResult>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ result: VerifyResult }>(`/verify/${token}`)
      .then((data) => {
        if (!cancelled) setResult(data.result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not verify this certificate.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-ink">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Certificate verification</h1>

        {loading ? (
          <p className="mt-6 text-sm text-ink/60">Checking…</p>
        ) : error ? (
          <p className="mt-6 text-sm text-red-600">{error}</p>
        ) : !result ? (
          <div className="mt-6 rounded-md bg-red-50 px-4 py-3 text-red-700">
            <p className="font-medium">Not found</p>
            <p className="mt-1 text-sm">This certificate link does not match any issued certificate.</p>
          </div>
        ) : (
          <div className={`mt-6 rounded-md px-4 py-4 ${result.valid ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            <p className="text-lg font-semibold">{result.valid ? 'Valid certificate' : 'Revoked certificate'}</p>
            <dl className="mt-3 space-y-1 text-sm">
              <div>
                <dt className="inline font-medium">Name: </dt>
                <dd className="inline">{result.recipient_name}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Type: </dt>
                <dd className="inline">{TYPE_LABELS[result.certificate_type] ?? result.certificate_type}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Conference: </dt>
                <dd className="inline">{result.conference_name}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Issued: </dt>
                <dd className="inline">{formatKathmandu(result.issued_at)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}
