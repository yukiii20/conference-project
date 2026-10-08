import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { MyRoleRow, MyRoleRequestRow } from '../lib/types'

type Props =
  | { kind: 'convenor'; children: React.ReactNode }
  | { kind: 'role'; role: string; children: React.ReactNode }

/**
 * Re-checks access every time this route is mounted (i.e. on every
 * navigation to it), not just once at login — a pending/rejected/removed
 * role never grants access, and an approval takes effect on the next visit.
 */
export function ProtectedRoute(props: Props) {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking')
  const roleKey = props.kind === 'role' ? props.role : null

  useEffect(() => {
    let cancelled = false

    async function check() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        if (!cancelled) setState('denied')
        return
      }

      if (props.kind === 'convenor') {
        const { data } = await supabase.rpc('get_my_roles')
        const roles = (data ?? []) as MyRoleRow[]
        const ok = roles.some((r) => r.role_code === 'convenor')
        if (!cancelled) setState(ok ? 'ok' : 'denied')
        return
      }

      const { data } = await supabase.rpc('get_my_role_requests')
      const requests = (data ?? []) as MyRoleRequestRow[]
      const ok = requests.some((r) => r.role_code === roleKey && r.status === 'approved')
      if (!cancelled) setState(ok ? 'ok' : 'denied')
    }

    setState('checking')
    check()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.kind, roleKey])

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
