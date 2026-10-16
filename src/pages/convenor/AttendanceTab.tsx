import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { registrationCategorySchema } from '../../lib/validation'
import { AttendanceDashboard } from '../../components/attendance/AttendanceDashboard'
import { RegistrationsList } from '../../components/attendance/RegistrationsList'

// Lazy: CheckInPanel pulls in the zxing QR-scanning library (~450 KB) that
// only the small fraction of visitors who reach this tab actually need.
const CheckInPanel = lazy(() => import('../../components/attendance/CheckInPanel'))

type Category = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  display_order: number
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

export function AttendanceTab({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="mt-6 max-w-5xl">
      <AttendanceDashboard conferenceId={conferenceId} refreshKey={refreshKey} />
      <div className="mt-10">
        <CategoriesSection conferenceId={conferenceId} onChanged={() => setRefreshKey((k) => k + 1)} />
      </div>
      <div className="mt-10">
        <h3 className="text-lg font-medium text-ink">Registrations</h3>
        <RegistrationsList conferenceId={conferenceId} />
      </div>
      <div className="mt-10">
        <h3 className="text-lg font-medium text-ink">Check-in</h3>
        <div className="mt-3">
          <Suspense fallback={<p className="text-sm text-ink/60">Loading…</p>}>
            <CheckInPanel conferenceId={conferenceId} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
