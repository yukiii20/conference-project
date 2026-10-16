import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'

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
export function RegistrationsList({ conferenceId, readOnly = false }: { conferenceId: string; readOnly?: boolean }) {
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ categories: Category[] }>(`/conferences/${conferenceId}/registration-categories`)
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]))
  }, [conferenceId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query: Record<string, string | undefined> = {}
      if (search) query.search = search
      if (status) query.status = status
      if (categoryId) query.category_id = categoryId
      const data = await api.get<{ registrations: AdminRegistration[] }>(`/conferences/${conferenceId}/registrations`, query)
      setRegistrations(data.registrations)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load registrations.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, search, status, categoryId])

  useEffect(() => {
    load()
  }, [load])

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

  async function cancelRegistration(id: string) {
    if (!window.confirm('Cancel this registration?')) return
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

  return (
    <div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or number"
          className="min-w-[220px] flex-1 rounded-md border border-line px-3 py-2 text-sm focus:border-button"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
        >
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
        >
          <option value="">Any category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <a
          href={`${API_BASE}/conferences/${conferenceId}/registrations/export.csv`}
          className="rounded-md border border-line px-3 py-2 text-sm hover:bg-background"
        >
          Export CSV
        </a>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-ink/60">Loading…</p>
      ) : registrations.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-white px-4 py-4 text-sm text-ink/70">No registrations yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Registered</th>
                {readOnly ? null : <th className="px-4 py-2 font-medium"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {registrations.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono text-xs">{r.registration_number}</td>
                  <td className="px-4 py-2">
                    {r.full_name}
                    <div className="text-xs text-ink/50">{r.email}</div>
                  </td>
                  <td className="px-4 py-2">{r.category_name}</td>
                  <td className="px-4 py-2 capitalize">{r.status}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatKathmandu(r.registered_at)}</td>
                  {readOnly ? null : (
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        {r.status === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => confirmRegistration(r.id)}
                            disabled={busyId === r.id}
                            className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          >
                            Confirm
                          </button>
                        ) : null}
                        {r.status !== 'cancelled' ? (
                          <button
                            type="button"
                            onClick={() => cancelRegistration(r.id)}
                            disabled={busyId === r.id}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
