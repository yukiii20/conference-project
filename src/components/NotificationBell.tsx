import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { Icon } from './ui/Icon'
import type { NotificationRow } from '../lib/types'

const POLL_MS = 60_000

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationBell() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const load = useCallback(async () => {
    if (document.hidden) return
    try {
      const data = await api.get<{ notifications: NotificationRow[] }>('/me/notifications')
      setNotifications(data.notifications)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load notifications.')
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_MS)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function handleOpen() {
    const next = !open
    setOpen(next)
    if (next) await load()
  }

  async function handleSelect(notification: NotificationRow) {
    setOpen(false)
    if (!notification.read_at) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n)),
      )
      api.post(`/me/notifications/${notification.id}/read`).catch(() => {})
    }
    if (notification.link_path) navigate(notification.link_path)
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    try {
      await api.post('/me/notifications/read-all')
    } catch {
      await load()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
      >
        <Icon icon={Bell} size={19} />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white ring-2 ring-surface">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[min(90vw,24rem)] animate-pop-in overflow-hidden rounded-xl border border-border-soft bg-surface text-text shadow-pop max-sm:-right-24">
          <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            <button type="button" onClick={handleMarkAllRead} className="text-xs font-medium text-button hover:underline disabled:opacity-50 disabled:no-underline" disabled={unreadCount === 0}>
              Mark all read
            </button>
          </div>

          {error ? <p className="px-3 py-3 text-sm text-danger">{error}</p> : null}

          <ul className="max-h-96 divide-y divide-border-soft overflow-y-auto">
            {notifications.length === 0 && !error ? (
              <li className="px-4 py-10 text-center text-sm text-text-muted">No notifications yet.</li>
            ) : (
              notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(n)}
                    className={`relative block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-page-bg ${n.read_at ? '' : 'bg-indigo-soft/60 before:absolute before:inset-y-3 before:left-1.5 before:w-1 before:rounded-full before:bg-button'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`font-medium ${n.read_at ? 'text-text-muted' : 'text-text'}`}>{n.title}</span>
                      <span className="shrink-0 text-xs text-text-muted/70">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body ? <p className="mt-0.5 text-text-muted">{n.body}</p> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
