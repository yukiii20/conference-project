import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'
import { ChevronDownIcon } from './ui/icons'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    navigate('/login')
  }

  const displayName = user?.full_name ?? user?.email ?? ''

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 bg-brand px-4 py-3 text-on-brand">
      <span className="font-semibold">Conference management system</span>
      <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{roleLabel}</span>
        <NotificationBell />

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1 hover:bg-white/10"
          >
            <Avatar photoPath={user?.photo_path ?? null} name={displayName} size="h-7 w-7" />
            <span className="max-w-[12rem] truncate">{displayName}</span>
            <ChevronDownIcon className="h-4 w-4 flex-shrink-0" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface text-text shadow-lg"
            >
              <Link
                to="/profile"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block min-h-10 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                Profile
              </Link>
              <Link
                to="/change-password"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block min-h-10 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                Change password
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="block w-full min-h-10 px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
