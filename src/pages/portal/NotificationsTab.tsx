import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import type { NotificationRow } from '../../lib/types'
import { formatKathmandu } from '../../lib/datetime'

export function NotificationsTab() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ notifications: NotificationRow[] }>('/me/notifications')
      setNotifications(data.notifications)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load notifications.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleSelect(n: NotificationRow) {
    if (!n.read_at) {
      setNotifications((prev) => prev.map((row) => (row.id === n.id ? { ...row, read_at: new Date().toISOString() } : row)))
      api.post(`/me/notifications/${n.id}/read`).catch(() => {})
    }
    if (n.link_path) navigate(n.link_path)
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
    <div className="mt-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-ink">Notifications</h2>
        <button
          type="button"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
          className="text-sm text-button underline disabled:opacity-50"
        >
          Mark all read
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-4 text-sm text-ink/60">Loading…</p>
      ) : notifications.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No notifications yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => handleSelect(n)}
                className={`block w-full px-4 py-3 text-left hover:bg-background ${n.read_at ? '' : 'bg-button/5'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-sm font-medium ${n.read_at ? 'text-ink/70' : 'text-ink'}`}>{n.title}</span>
                  <span className="shrink-0 text-xs text-ink/40">{formatKathmandu(n.created_at)}</span>
                </div>
                {n.body ? <p className="mt-1 text-sm text-ink/60">{n.body}</p> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
