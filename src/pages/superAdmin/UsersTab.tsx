import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import {
  Alert,
  Badge,
  Button,
  type Column,
  ConfirmDialog,
  FormField,
  Input,
  Modal,
  Pagination,
  StatusChip,
  Table,
} from '../../components/ui'
import { formatDate, formatDateTime, type ProfileRow } from './shared'

export function isLocked(p: ProfileRow): boolean {
  return Boolean(p.locked_until && new Date(p.locked_until).getTime() > Date.now())
}

export function UsersTab() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [anonymizeTarget, setAnonymizeTarget] = useState<ProfileRow | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    profile: ProfileRow
    action: string
    confirmMessage: string
    successMessage: string
  } | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const reload = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ users: ProfileRow[]; page: number; page_size: number; total: number }>(
        '/admin/users',
        { query: query.trim() || undefined, page: String(page) },
      )
      setResults(data.users)
      setTotal(data.total)
      setPageSize(data.page_size)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load users.')
    }
     
  }, [query, page])

  // A new search invalidates the current page - start back at page 1 rather
  // than risk landing past the end of a now-smaller result set.
  useEffect(() => {
    setPage(1)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const handle = setTimeout(async () => {
      await reload()
      if (!cancelled) setLoading(false)
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page])

  function runAction(profile: ProfileRow, action: string, confirmMessage: string, successMessage: string) {
    setPendingAction({ profile, action, confirmMessage, successMessage })
  }

  async function performAction() {
    if (!pendingAction) return
    const { profile, action, successMessage } = pendingAction
    setPendingAction(null)
    setBusyId(profile.id)
    setError(null)
    setNotice(null)
    try {
      await api.post(`/admin/users/${profile.id}/${action}`)
      setNotice(successMessage)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete this action.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleResetPassword(profile: ProfileRow) {
    await runAction(
      profile,
      'reset-password',
      `Send a password reset link to ${profile.email ?? 'this user'}?`,
      `Reset link sent to ${profile.email ?? 'this user'}.`,
    )
  }

  async function handleSuspend(profile: ProfileRow) {
    await runAction(profile, 'suspend', `Suspend ${profile.email ?? 'this user'}? They will be signed out everywhere.`, 'User suspended.')
  }

  async function handleReactivate(profile: ProfileRow) {
    await runAction(profile, 'reactivate', `Reactivate ${profile.email ?? 'this user'}?`, 'User reactivated.')
  }

  async function handleDeactivate(profile: ProfileRow) {
    await runAction(
      profile,
      'deactivate',
      `Deactivate ${profile.email ?? 'this user'}? They will be signed out everywhere.`,
      'User deactivated.',
    )
  }

  async function handleUnlock(profile: ProfileRow) {
    await runAction(profile, 'unlock', `Clear the login lockout for ${profile.email ?? 'this user'}?`, 'User unlocked.')
  }

  async function confirmAnonymize(typedEmail: string) {
    const profile = anonymizeTarget
    if (!profile || !profile.email || typedEmail.trim().toLowerCase() !== profile.email.toLowerCase()) return
    setBusyId(profile.id)
    setError(null)
    setNotice(null)
    try {
      await api.post(`/admin/users/${profile.id}/anonymize`)
      setNotice('User anonymised.')
      setAnonymizeTarget(null)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not anonymise this user.')
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<ProfileRow>[] = [
    { key: 'name', header: 'Name', render: (p) => p.full_name ?? '—' },
    { key: 'email', header: 'Email', render: (p) => p.email ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <div className="flex flex-col gap-1">
          <StatusChip status={p.status ?? 'active'} />
          {isLocked(p) ? <Badge tone="danger">Locked until {formatDateTime(p.locked_until!)}</Badge> : null}
        </div>
      ),
    },
    { key: 'joined', header: 'Joined', render: (p) => formatDate(p.created_at) },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <div className="flex flex-wrap gap-1.5">
          {isLocked(p) ? (
            <Button variant="secondary" size="sm" onClick={() => handleUnlock(p)} disabled={busyId === p.id}>
              Unlock
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => handleResetPassword(p)} disabled={busyId === p.id}>
            Reset password
          </Button>
          {p.status === 'suspended' || p.status === 'deactivated' ? (
            <Button variant="secondary" size="sm" onClick={() => handleReactivate(p)} disabled={busyId === p.id}>
              Reactivate
            </Button>
          ) : (
            <>
              <Button variant="danger" size="sm" onClick={() => handleSuspend(p)} disabled={busyId === p.id}>
                Suspend
              </Button>
              <Button variant="danger" size="sm" onClick={() => handleDeactivate(p)} disabled={busyId === p.id}>
                Deactivate
              </Button>
            </>
          )}
          <Button variant="danger" size="sm" onClick={() => setAnonymizeTarget(p)} disabled={busyId === p.id}>
            Anonymise
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="mt-6">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" className="w-full max-w-md" />

      <div className="mt-2 space-y-2">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}
      </div>

      <div className="mt-4">
        <Table<ProfileRow>
          columns={columns}
          rows={results}
          rowKey={(p) => p.id}
          loading={loading}
          emptyTitle="No users found."
          minWidth={760}
        />
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />

      {anonymizeTarget ? (
        <AnonymizeConfirmDialog
          profile={anonymizeTarget}
          busy={busyId === anonymizeTarget.id}
          onCancel={() => setAnonymizeTarget(null)}
          onConfirm={confirmAnonymize}
        />
      ) : null}

      <ConfirmDialog
        open={pendingAction !== null}
        title="Confirm this action"
        message={pendingAction?.confirmMessage ?? ''}
        confirmLabel="Confirm"
        confirmVariant={pendingAction?.action === 'reset-password' || pendingAction?.action === 'reactivate' || pendingAction?.action === 'unlock' ? 'primary' : 'danger'}
        busy={busyId === pendingAction?.profile.id}
        onConfirm={performAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  )
}

export function AnonymizeConfirmDialog({
  profile,
  busy,
  onCancel,
  onConfirm,
}: {
  profile: ProfileRow
  busy: boolean
  onCancel: () => void
  onConfirm: (typedEmail: string) => void
}) {
  const [typedEmail, setTypedEmail] = useState('')
  const matches = profile.email != null && typedEmail.trim().toLowerCase() === profile.email.toLowerCase()

  return (
    <Modal open onClose={onCancel} title="Anonymise this user?" size="sm">
      <p className="mt-2 text-sm text-text-muted">
        This permanently replaces {profile.full_name ?? 'this user'}'s name, email, phone and profile photo with
        placeholders, and signs them out everywhere. Their submission and review history is kept. This cannot be
        undone.
      </p>
      <div className="mt-4">
        <FormField label={`Type their email (${profile.email}) to confirm`} htmlFor="anonymize-confirm-email">
          <Input
            id="anonymize-confirm-email"
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.target.value)}
            autoFocus
          />
        </FormField>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => onConfirm(typedEmail)} disabled={!matches} loading={busy}>
          Anonymise
        </Button>
      </div>
    </Modal>
  )
}
