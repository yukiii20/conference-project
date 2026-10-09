import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
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
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
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
        className="relative rounded border border-white/40 px-2.5 py-1 hover:bg-white/10"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 16z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[90vw] max-w-sm rounded-lg border border-line bg-white text-ink shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <button type="button" onClick={handleMarkAllRead} className="text-xs text-button underline disabled:opacity-50" disabled={unreadCount === 0}>
              Mark all read
            </button>
          </div>

          {error ? <p className="px-3 py-3 text-sm text-red-600">{error}</p> : null}

          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {notifications.length === 0 && !error ? (
              <li className="px-3 py-6 text-center text-sm text-ink/50">No notifications yet.</li>
            ) : (
              notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(n)}
                    className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-background ${n.read_at ? '' : 'bg-button/5'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`font-medium ${n.read_at ? 'text-ink/70' : 'text-ink'}`}>{n.title}</span>
                      <span className="shrink-0 text-xs text-ink/40">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body ? <p className="mt-0.5 text-ink/60">{n.body}</p> : null}
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
