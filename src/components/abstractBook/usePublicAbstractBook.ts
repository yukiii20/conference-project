import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

/** Whether the convenor has published the book of abstracts for public download on the conference page. */
export function usePublicAbstractBook(conferenceId: string | null): { available: boolean; url: string | null } {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (!conferenceId) {
      setAvailable(false)
      return
    }
    let cancelled = false
    api
      .get<{ available: boolean }>(`/conferences/${conferenceId}/abstract-book/public`)
      .then((d) => {
        if (!cancelled) setAvailable(d.available)
      })
      .catch(() => {
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  return { available, url: conferenceId && available ? `/api/conferences/${conferenceId}/abstract-book/public.pdf` : null }
}
