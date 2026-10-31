import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import { useToast } from '../ui/Toast'

type AgendaSnapshot = { starred: Set<string>; automatic: Set<string> }

const EMPTY: AgendaSnapshot = { starred: new Set(), automatic: new Set() }

/**
 * Star state for the public programme. Signed-out visitors see empty stars;
 * tapping one sends them to this conference's sign-in page (stars are saved per account).
 */
export function useAgendaStars(conferenceId: string | null, conferenceSlug: string | null = null) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<AgendaSnapshot>(EMPTY)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!conferenceId || !user) {
      setSnapshot(EMPTY)
      return
    }
    try {
      const data = await api.get<{ starred_ids: string[]; sessions: Array<{ id: string; reasons: string[] }> }>(
        `/conferences/${conferenceId}/my-agenda`,
      )
      setSnapshot({
        starred: new Set(data.starred_ids),
        automatic: new Set(data.sessions.filter((s) => s.reasons.some((r) => r !== 'starred')).map((s) => s.id)),
      })
    } catch {
      setSnapshot(EMPTY)
    }
  }, [conferenceId, user])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(sessionId: string) {
    if (!conferenceId) return
    if (!user) {
      showToast('Sign in to build your agenda.', 'info')
      navigate(conferenceSlug ? `/c/${encodeURIComponent(conferenceSlug)}/login` : '/login')
      return
    }
    const isStarred = snapshot.starred.has(sessionId)
    setBusyId(sessionId)
    try {
      if (isStarred) await api.del(`/conferences/${conferenceId}/my-agenda/${sessionId}`)
      else await api.put(`/conferences/${conferenceId}/my-agenda/${sessionId}`)
      showToast(isStarred ? 'Removed from My agenda.' : 'Added to My agenda.', 'success')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update your agenda.', 'error')
    }
    setBusyId(null)
  }

  return { ...snapshot, busyId, toggle }
}
