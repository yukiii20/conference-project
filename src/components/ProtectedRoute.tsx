import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'

type Props =
  | { kind: 'convenor'; children: React.ReactNode }
  | { kind: 'role'; role: string; children: React.ReactNode }

/**
 * Re-checks access every time this route is mounted (i.e. on every
 * navigation to it), not just once at login — a pending/rejected/removed
 * role never grants access, and an approval takes effect on the next visit.
 * Identity comes only from useAuth()'s refresh(), i.e. GET /api/auth/me —
 * never from a Supabase session.
 */
export function ProtectedRoute(props: Props) {
  const { refresh } = useAuth()
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking')
  const roleKey = props.kind === 'role' ? props.role : 'convenor'

  useEffect(() => {
    let cancelled = false

    async function check() {
      setState('checking')
      const data = await refresh()
      if (cancelled) return
      const ok = data?.roles.some((r) => r.role_code === roleKey) ?? false
      setState(ok ? 'ok' : 'denied')
    }

    check()
    return () => {
      cancelled = true
    }
  }, [roleKey, refresh])

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-ink">
        Loading…
      </div>
    )
  }

  if (state === 'denied') {
    return <Navigate to="/login" replace />
  }

  return <>{props.children}</>
}
