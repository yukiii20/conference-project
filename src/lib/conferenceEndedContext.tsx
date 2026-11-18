import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'
import { isConferenceEnded } from './conferenceEnded'

/** True inside the portal while the selected conference has ended (changes-nov2, Part 2). */
export const ConferenceEndedContext = createContext(false)

export function useConferenceEnded(): boolean {
  return useContext(ConferenceEndedContext)
}

/** Loads the selected conference's end date from the public conference endpoint. */
export function useConferenceEndedBySlug(slug: string | null): boolean {
  const [endDate, setEndDate] = useState<{ slug: string; end_date: string } | null>(null)
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    api
      .get<{ conference: { end_date: string } }>(`/conferences/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (!cancelled) setEndDate({ slug, end_date: res.conference.end_date })
      })
      .catch(() => {
        // Not knowing the end date only hides the notice; the server still refuses blocked actions.
      })
    return () => {
      cancelled = true
    }
  }, [slug])
  return Boolean(slug && endDate?.slug === slug && isConferenceEnded(endDate.end_date))
}
