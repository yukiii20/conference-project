import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { StatusChip } from '../ui/Badge'
import { ConfirmDialog } from '../ui/Modal'
import { Table, Pagination } from '../ui/Table'
import type { Column } from '../ui/Table'
import { Alert, Button, Input, Select } from '../ui'

type Category = { id: string; name: string }

type AdminRegistration = {
  id: string
  registration_number: string
  full_name: string
  email: string
  category_name: string
  status: 'pending' | 'confirmed' | 'waitlisted' | 'cancelled'
  amount_due: string
  currency: string
  registered_at: string
}

/**
 * Shared by the convenor/manager Attendance tab (full control) and the
 * staff "Registrations" view (read-only — no confirm/cancel, same search,
 * status and category filters, same CSV export).
 */
export function RegistrationsList({
  conferenceId,
  readOnly = false,
  initialStatus = '',
}: {
  conferenceId: string
  readOnly?: boolean
  /** Pre-selects the status filter — e.g. the convenor dashboard's "Pending registrations" attention item links here with `pending`, so the convenor lands straight on the ones that need confirming. */
  initialStatus?: string
}) {
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [categoryId, setCategoryId] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  useEffect(() => {
    api
      .get<{ categories: Category[] }>(`/conferences/${conferenceId}/registration-categories`)
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]))
  }, [conferenceId])

  // Debounced so typing doesn't fire a request per keystroke - the input
  // itself stays instantly responsive via `search`, only the API call waits.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query: Record<string, string | undefined> = { page: String(page) }
      if (debouncedSearch) query.search = debouncedSearch
      if (status) query.status = status
      if (categoryId) query.category_id = categoryId
      const data = await api.get<{ registrations: AdminRegistration[]; page: number; page_size: number; total: number }>(
        `/conferences/${conferenceId}/registrations`,
        query,
      )
      setRegistrations(data.registrations)
      setTotal(data.total)
      setPageSize(data.page_size)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load registrations.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, debouncedSearch, status, categoryId, page])

  useEffect(() => {
    load()
  }, [load])

  // Any filter change invalidates the current page - go back to page 1 rather
  // than risk landing past the end of a now-smaller result set.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status, categoryId])

  async function confirmRegistration(id: string) {
    setBusyId(id)
    try {
      await api.patch(`/conferences/${conferenceId}/registrations/${id}/confirm`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm this registration.')
    } finally {
      setBusyId(null)
    }
  }

  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null)

  async function cancelRegistration(id: string) {
    setConfirmingCancelId(null)
    setBusyId(id)
    try {
      await api.del(`/conferences/${conferenceId}/registrations/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this registration.')
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<AdminRegistration>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-mono text-xs">{r.registration_number}</span> },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <>
          {r.full_name}
          <div className="text-xs text-text-muted">{r.email}</div>
        </>
      ),
    },
    { key: 'category', header: 'Category', render: (r) => r.category_name },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    { key: 'registered', header: 'Registered', render: (r) => formatKathmandu(r.registered_at), className: 'whitespace-nowrap' },
    ...(readOnly
      ? []
      : [
          {
            key: 'actions',
            header: '',
            render: (r: AdminRegistration) => (
              <div className="flex gap-2">
                {r.status === 'pending' ? (
                  <Button type="button" variant="link" size="sm" disabled={busyId === r.id} onClick={() => confirmRegistration(r.id)}>
                    Confirm
                  </Button>
                ) : null}
                {r.status !== 'cancelled' ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="!text-danger"
                    disabled={busyId === r.id}
                    onClick={() => setConfirmingCancelId(r.id)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]),
  ]

  return (
    <div>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or number"
          className="min-w-[220px] flex-1"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-auto">
          <option value="">Any category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <a
          href={`${API_BASE}/conferences/${conferenceId}/registrations/export.csv`}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-button px-4 py-2 text-sm font-medium text-button hover:bg-outline-hover"
        >
          Export CSV
        </a>
      </div>

      <div className="mt-3">
        <Table
          columns={columns}
          rows={registrations}
          rowKey={(r) => r.id}
          loading={loading}
          emptyTitle="No registrations yet."
          minWidth={800}
        />
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />

      <ConfirmDialog
        open={confirmingCancelId !== null}
        title="Cancel this registration?"
        message="The attendee will need to register again if they still want to attend."
        confirmLabel="Cancel registration"
        busy={busyId === confirmingCancelId}
        onConfirm={() => confirmingCancelId && cancelRegistration(confirmingCancelId)}
        onCancel={() => setConfirmingCancelId(null)}
      />
    </div>
  )
}
