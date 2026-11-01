import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  Icon,
  Input,
  Spinner,
} from '../../components/ui'
import { type PlatformAdminRow } from './shared'

export function AdminsTab() {
  const { isSuperAdmin, user } = useAuth()
  const [admins, setAdmins] = useState<PlatformAdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingRevoke, setConfirmingRevoke] = useState<PlatformAdminRow | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ admins: PlatformAdminRow[] }>('/admin/admins')
      setAdmins(data.admins)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load administrators.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await api.post('/admin/admins', { email: email.trim() })
      setNotice(`${email.trim()} is now a platform administrator.`)
      setEmail('')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not grant administrator access.')
    } finally {
      setSubmitting(false)
    }
  }

  async function setSuper(admin: PlatformAdminRow, makeSuper: boolean) {
    setBusyId(admin.id)
    setError(null)
    setNotice(null)
    try {
      if (makeSuper) await api.post(`/admin/admins/${admin.id}/super`)
      else await api.del(`/admin/admins/${admin.id}/super`)
      setNotice(makeSuper ? `${admin.full_name} is now a super administrator.` : `${admin.full_name} is now an ordinary administrator.`)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change super administrator access.')
    } finally {
      setBusyId(null)
    }
  }

  const anySuper = admins.some((a) => a.is_super_admin)

  async function handleRevoke(admin: PlatformAdminRow) {
    setConfirmingRevoke(null)
    setBusyId(admin.id)
    setError(null)
    setNotice(null)
    try {
      await api.del(`/admin/admins/${admin.id}`)
      setNotice(`Administrator access removed from ${admin.email}.`)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove administrator access.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-6 max-w-2xl space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <p className="text-sm text-text-muted">
        Super administrators can also add or remove administrators, change platform settings and lock other admin accounts.
        {anySuper ? '' : ' Nobody is a super administrator yet, so every administrator can do this for now — the first person you make a super administrator (and you) will be the only ones.'}
      </p>

      {!isSuperAdmin ? (
        <Alert variant="info">Only a super administrator can add or remove administrators.</Alert>
      ) : (
      <Card>
        <form onSubmit={handleGrant} className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <FormField label="Add administrator by email" htmlFor="grant-admin-email" help="The account must already exist.">
              <Input
                id="grant-admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
                required
              />
            </FormField>
          </div>
          <Button type="submit" loading={submitting} iconLeft={<Icon icon={Plus} size={16} />}>
            Add admin
          </Button>
        </form>
      </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Spinner size="sm" /> Loading…
        </div>
      ) : admins.length === 0 ? (
        <Card>
          <EmptyState title="No administrators found." />
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-text">
                  {a.full_name}
                  {a.is_super_admin ? (
                    <span className="ml-2 rounded-full bg-gold-soft px-2 py-0.5 align-middle text-xs font-medium text-gold-ink">Super admin</span>
                  ) : null}
                </p>
                <p className="text-sm text-text-muted">{a.email}</p>
              </div>
              {isSuperAdmin ? (
                <div className="flex flex-wrap gap-2">
                  {a.is_super_admin ? (
                    a.id !== user?.id ? (
                      <Button variant="secondary" size="sm" onClick={() => setSuper(a, false)} disabled={busyId === a.id}>
                        Remove super admin
                      </Button>
                    ) : null
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => setSuper(a, true)} disabled={busyId === a.id}>
                      Make super admin
                    </Button>
                  )}
                  <Button variant="danger" size="sm" onClick={() => setConfirmingRevoke(a)} disabled={busyId === a.id}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmingRevoke !== null}
        title="Remove administrator access?"
        message={confirmingRevoke ? `Remove administrator access from ${confirmingRevoke.full_name} (${confirmingRevoke.email})?` : ''}
        confirmLabel="Remove access"
        busy={busyId === confirmingRevoke?.id}
        onConfirm={() => confirmingRevoke && handleRevoke(confirmingRevoke)}
        onCancel={() => setConfirmingRevoke(null)}
      />
    </div>
  )
}
