import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import type { NotificationRow } from '../../lib/types'
import { formatKathmandu } from '../../lib/datetime'
import { Alert, Button, EmptyState, PageHeader, SkeletonText } from '../../components/ui'

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
      <PageHeader
        title="Notifications"
        actions={
          <Button type="button" variant="link" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
            Mark all read
          </Button>
        }
      />

      {error ? (
        <Alert variant="danger">{error}</Alert>
      ) : null}

      {loading ? (
        <SkeletonText lines={4} className="mt-4" />
      ) : notifications.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No notifications yet." />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => handleSelect(n)}
                className={`block w-full px-4 py-3 text-left hover:bg-surface-muted ${n.read_at ? '' : 'bg-brand/5'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-sm font-medium ${n.read_at ? 'text-text-muted' : 'text-text'}`}>{n.title}</span>
                  <span className="shrink-0 text-xs text-text-muted">{formatKathmandu(n.created_at)}</span>
                </div>
                {n.body ? <p className="mt-1 text-sm text-text-muted">{n.body}</p> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
