import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Plus, Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { registrationCategorySchema } from '../../lib/validation'
import { AttendanceDashboard } from '../../components/attendance/AttendanceDashboard'
import { RegistrationsList } from '../../components/attendance/RegistrationsList'
import { PageHeader, Table, StatusChip, Button, FormField, Input, Checkbox, Alert, Spinner } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'
import type { Column } from '../../components/ui/Table'

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

  const columns: Column<Category>[] = [
    { key: 'code', header: 'Code', render: (c) => <span className="font-mono text-xs">{c.code}</span> },
    { key: 'name', header: 'Name', render: (c) => c.name },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.is_active ? 'active' : 'inactive'} /> },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <Button variant="link" size="sm" onClick={() => startEdit(c)}>
          Edit
        </Button>
      ),
    },
  ]

  return (
    <div>
      <h3 className="text-lg font-medium text-text">Registration categories</h3>
      {error ? (
        <div className="mt-2">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-3">
        <Table columns={columns} rows={categories} rowKey={(c) => c.id} loading={loading} emptyTitle="No categories yet." minWidth={500} />
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-surface p-4">
        <FormField label="Code">
          <Input
            value={form.code}
            onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
            placeholder="student"
            className="w-32"
          />
        </FormField>
        <FormField label="Name">
          <Input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Student"
            className="w-40"
          />
        </FormField>
        <FormField label="Order">
          <Input
            type="number"
            value={form.display_order}
            onChange={(e) => setForm((p) => ({ ...p, display_order: Number(e.target.value) }))}
            className="w-20"
          />
        </FormField>
        <Checkbox
          label="Active"
          checked={form.is_active}
          onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={saving}
          loading={saving}
          iconLeft={<Icon icon={editingId ? Save : Plus} size={16} />}
        >
          {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add category'}
        </Button>
        {editingId ? (
          <Button type="button" variant="secondary" onClick={resetForm}>
            Cancel
          </Button>
        ) : null}
      </form>
    </div>
  )
}

export function AttendanceTab({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="mt-6 max-w-5xl">
      <PageHeader title="Attendance" subtitle="Registration categories, registrations, and event check-in." />
      <AttendanceDashboard conferenceId={conferenceId} refreshKey={refreshKey} />
      <div className="mt-10">
        <CategoriesSection conferenceId={conferenceId} onChanged={() => setRefreshKey((k) => k + 1)} />
      </div>
      <div className="mt-10">
        <h3 className="text-lg font-medium text-text">Registrations</h3>
        <RegistrationsList conferenceId={conferenceId} />
      </div>
      <div className="mt-10">
        <h3 className="text-lg font-medium text-text">Check-in</h3>
        <div className="mt-3">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Spinner size="sm" /> Loading…
              </div>
            }
          >
            <CheckInPanel conferenceId={conferenceId} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
