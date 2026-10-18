import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { PageLoading } from '../components/PageLoading'
import { ErrorState } from '../components/ui/EmptyState'

// Same chunk as the /convenor and /manager routes in App.tsx - Vite/Rollup
// dedupe every dynamic import() of this module into one shared chunk.
const ConvenorPage = lazy(() => import('./ConvenorPage').then((m) => ({ default: m.ConvenorPage })))

/**
 * Entry point for the admin's "View as admin" action: logs the audit entry,
 * then renders the normal convenor portal pointed at this conference, in the
 * portal's own read-only mode (see ConvenorPage's `viewAs` prop).
 */
export function AdminViewAsPage() {
  const { conferenceId } = useParams<{ conferenceId: string }>()
  const location = useLocation()
  const stateName = (location.state as { name?: string } | null)?.name ?? null

  const [conferenceName, setConferenceName] = useState<string | null>(stateName)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!conferenceId) return
    let cancelled = false

    async function start() {
      try {
        const result = await api.post<{ slug: string }>(`/admin/conferences/${conferenceId}/view-as`)
        if (cancelled) return
        if (!stateName) {
          const list = await api.get<{ conferences: Array<{ id: string; name: string }> }>('/admin/conferences')
          if (cancelled) return
          setConferenceName(list.conferences.find((c) => c.id === conferenceId)?.name ?? result.slug)
        }
        setReady(true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not open this conference.')
      }
    }

    start()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenceId])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-ink">
        <ErrorState message={error} />
      </div>
    )
  }

  if (!ready || !conferenceId) {
    return <PageLoading />
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <ConvenorPage viewAs={{ conferenceId, conferenceName: conferenceName ?? '' }} />
    </Suspense>
  )
}
