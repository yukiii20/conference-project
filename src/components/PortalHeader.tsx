import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'

/**
 * Identity (name, photo) comes only from the shared auth context, i.e.
 * GET /api/auth/me — this header is always rendered inside a route guard
 * (ProtectedRoute / SuperAdminRoute) that has already refreshed it, so no
 * fetch happens here. Sign-out goes through the same context (POST
 * /api/auth/logout) — never a client-side auth SDK.
 */
export function PortalHeader({ roleLabel }: { roleLabel: string }) {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 bg-button px-4 py-3 text-white">
      <span className="font-semibold">Conference management system</span>
      <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        <Avatar photoPath={user?.photo_path ?? null} name={user?.full_name ?? user?.email ?? ''} size="h-7 w-7" />
        <span>{user?.full_name ?? user?.email ?? ''}</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{roleLabel}</span>
        <NotificationBell />
        <Link to="/profile" className="inline-flex min-h-10 items-center rounded-md border border-white/40 px-4 py-2 hover:bg-white/10">
          Profile
        </Link>
        <Link to="/change-password" className="inline-flex min-h-10 items-center rounded-md border border-white/40 px-4 py-2 hover:bg-white/10">
          Change password
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex min-h-10 items-center rounded-md border border-white/40 px-4 py-2 hover:bg-white/10"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
