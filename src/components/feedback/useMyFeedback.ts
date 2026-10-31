import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'

export type MyFeedbackSurvey = {
  conference_id: string
  conference_name: string
  conference_slug: string
  title: string
  closes_at: string
  responded: boolean
}

/** Feedback surveys open right now that the signed-in person may answer (checked in, chaired or presented). */
export function useMyFeedback(): { surveys: MyFeedbackSurvey[] | null; error: boolean; reload: () => Promise<void> } {
  const [surveys, setSurveys] = useState<MyFeedbackSurvey[] | null>(null)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    try {
      const data = await api.get<{ surveys: MyFeedbackSurvey[] }>('/me/feedback')
      setSurveys(data.surveys)
      setError(false)
    } catch {
      setSurveys([])
      setError(true)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { surveys, error, reload }
}
