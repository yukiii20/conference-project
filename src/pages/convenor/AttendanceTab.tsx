import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { registrationCategorySchema } from '../../lib/validation'
import { AttendanceDashboard, CheckInPanel } from '../../components/attendance/CheckInPanel'

type Category = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  display_order: number
}

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

const EMPTY_CATEGORY = { code: '', name: '', description: '', is_active: true, display_order: 0 }

function CategoriesSection({ conferenceId, onChanged }: { conferenceId: string; onChanged: () => void }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_CATEGORY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ categories: Category[] }>(`/conferences/${conferenceId}/registration-categories`)
      setCategories(data.categories)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load categories.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function startEdit(c: Category) {
    setEditingId(c.id)
    setForm({ code: c.code, name: c.name, description: c.description ?? '', is_active: c.is_active, display_order: c.display_order })
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_CATEGORY)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = registrationCategorySchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await api.patch(`/conferences/${conferenceId}/registration-categories/${editingId}`, parsed.data)
      } else {
        await api.post(`/conferences/${conferenceId}/registration-categories`, parsed.data)
      }
      resetForm()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this category.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h3 className="text-lg font-medium text-ink">Registration categories</h3>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-3 text-sm text-ink/60">Loading…</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[500px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-mono text-xs">{c.code}</td>
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2">{c.is_active ? 'Active' : 'Inactive'}</td>
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => startEdit(c)} className="text-xs text-button hover:underline">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-ink/60">Code</label>
          <input
            value={form.code}
            onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
            placeholder="student"
            className="mt-1 w-32 rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/60">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Student"
            className="mt-1 w-40 rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/60">Order</label>
          <input
            type="number"
            value={form.display_order}
            onChange={(e) => setForm((p) => ({ ...p, display_order: Number(e.target.value) }))}
            className="mt-1 w-20 rounded-md border border-line px-3 py-2 focus:border-button"
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
          Active
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add category'}
        </button>
        {editingId ? (
          <button type="button" onClick={resetForm} className="rounded-md border border-line px-4 py-2 text-sm hover:bg-background">
            Cancel
          </button>
        ) : null}
      </form>
    </div>
  )
}

function RegistrationsSection({ conferenceId }: { conferenceId: string }) {
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query: Record<string, string | undefined> = {}
      if (search) query.search = search
      if (status) query.status = status
      const data = await api.get<{ registrations: AdminRegistration[] }>(`/conferences/${conferenceId}/registrations`, query)
      setRegistrations(data.registrations)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load registrations.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, search, status])

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
    <div className="mt-10">
      <h3 className="text-lg font-medium text-ink">Registrations</h3>
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
                <th className="px-4 py-2 font-medium"></th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function AttendanceTab({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="mt-6 max-w-5xl">
      <AttendanceDashboard conferenceId={conferenceId} refreshKey={refreshKey} />
      <div className="mt-10">
        <CategoriesSection conferenceId={conferenceId} onChanged={() => setRefreshKey((k) => k + 1)} />
      </div>
      <RegistrationsSection conferenceId={conferenceId} />
      <div className="mt-10">
        <h3 className="text-lg font-medium text-ink">Check-in</h3>
        <div className="mt-3">
          <CheckInPanel conferenceId={conferenceId} />
        </div>
      </div>
    </div>
  )
}
