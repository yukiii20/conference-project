import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { AcceptedAbstractsList } from './AcceptedAbstractsList'

/**
 * "Accepted papers" on the public conference page. The server answers 404 unless the
 * organisers switched "show accepted abstracts on the public page" on (off by default), so
 * this renders nothing at all until then - no empty heading, no error.
 */
export function PublicAcceptedAbstracts({ conferenceId, style }: { conferenceId: string; style?: React.CSSProperties }) {
  const [enabled, setEnabled] = useState(false)
  const endpoint = `/conferences/${conferenceId}/abstracts/public`

  useEffect(() => {
    let cancelled = false
    setEnabled(false)
    api
      .get(endpoint)
      .then(() => !cancelled && setEnabled(true))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [endpoint])

  if (!enabled) return null
  return (
    <section id="accepted-papers" style={style} className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <h2 className="font-display text-3xl font-semibold tracking-tight">Accepted papers</h2>
      <div className="mt-4 max-w-3xl">
        <AcceptedAbstractsList endpoint={endpoint} />
      </div>
    </section>
  )
}
