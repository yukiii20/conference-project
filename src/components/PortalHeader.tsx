import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, LogOut, User } from 'lucide-react'
import { useAuth } from '../lib/authContext'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'
import { LogoMark } from './landing/LandingHeader'
import { ChevronDownIcon } from './ui/icons'
import { Icon } from './ui/Icon'

/**
 * Identity (name, photo) comes only from the shared auth context, i.e.
 * GET /api/auth/me — this header is always rendered inside a route guard
 * (ProtectedRoute / SuperAdminRoute) that has already refreshed it, so no
 * fetch happens here. Sign-out goes through the same context (POST
 * /api/auth/logout) — never a client-side auth SDK.
 *
 * Inside <AppShell> it's the top bar (`leading` = the mobile menu button,
 * `children` = breadcrumbs). On its own it shows the platform logo instead.
 */
export function PortalHeader({
  roleLabel,
  leading,
  tools,
  children,
}: {
  roleLabel: string
  leading?: ReactNode
  /** Extra top-bar controls (global search, help) shown before the notification bell. */
  tools?: ReactNode
  children?: ReactNode
}) {
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
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border-soft bg-surface/90 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        {children ?? (
          <Link to="/" className="flex min-w-0 items-center gap-2.5 font-semibold text-text">
            <LogoMark size={30} />
            <span className="truncate">Conference Management System</span>
          </Link>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <span className="hidden max-w-[16rem] truncate rounded-full border border-gold/60 bg-gold-soft px-2.5 py-0.5 text-xs font-medium text-gold-ink xl:inline">
          {roleLabel}
        </span>
        {tools}
        <NotificationBell />

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex min-h-10 items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-text transition-colors hover:bg-surface-muted"
          >
            <Avatar photoPath={user?.photo_path ?? null} name={displayName} size="h-8 w-8" />
            <span className="hidden max-w-[10rem] truncate font-medium md:inline">{displayName}</span>
            <ChevronDownIcon className={`h-4 w-4 flex-shrink-0 text-text-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-2 w-64 animate-pop-in overflow-hidden rounded-xl border border-border-soft bg-surface p-1.5 text-text shadow-pop"
            >
              <div className="border-b border-border-soft px-3 pb-2.5 pt-1.5">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                {user?.email && user.email !== displayName ? <p className="truncate text-xs text-text-muted">{user.email}</p> : null}
              </div>
              <div className="pt-1.5">
                <Link
                  to="/profile"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-page-bg"
                >
                  <Icon icon={User} className="text-text-muted" />
                  Profile
                </Link>
                <Link
                  to="/change-password"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-page-bg"
                >
                  <Icon icon={KeyRound} className="text-text-muted" />
                  Change password
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSignOut}
                  className="flex w-full min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger/5"
                >
                  <Icon icon={LogOut} />
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
