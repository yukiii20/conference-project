import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu, fromKathmanduInputValue, toKathmanduInputValue } from '../../lib/datetime'
import { formatMoney } from '../../lib/money'
import { FEE_TYPES, registrationFeeSchema } from '../../lib/validation'
import { Alert, Button, Checkbox, ConfirmDialog, FormField, Input, Select, StatusChip, Table } from '../ui'
import { Icon } from '../ui/Icon'
import type { Column } from '../ui/Table'

type Category = { id: string; name: string }
type Fee = {
  id: string
  category_id: string
  fee_type: (typeof FEE_TYPES)[number]
  amount: string
  currency: string
  valid_from: string
  valid_until: string
  is_active: boolean
}

export const FEE_TYPE_LABELS: Record<Fee['fee_type'], string> = {
  early_bird: 'Early bird',
  regular: 'Regular',
  late: 'Late',
  on_site: 'On site',
}

type FormState = {
  category_id: string
  fee_type: Fee['fee_type']
  amount: string
  currency: string
  valid_from: string
  valid_until: string
  is_active: boolean
}

const EMPTY: FormState = { category_id: '', fee_type: 'regular', amount: '', currency: 'NPR', valid_from: '', valid_until: '', is_active: true }

function isCurrent(f: Fee, now = Date.now()): boolean {
  return f.is_active && new Date(f.valid_from).getTime() <= now && new Date(f.valid_until).getTime() > now
}

/**
 * Prices per registration category, each valid for a time window (Nepal time). A category with
 * no prices is free; prices for one category may not overlap (the server rejects it).
 */
export function FeesSection({ conferenceId, categories, onChanged }: { conferenceId: string; categories: Category[]; onChanged: () => void }) {
  const [fees, setFees] = useState<Fee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ fees: Fee[] }>(`/conferences/${conferenceId}/registration-fees`)
      setFees(data.fees)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load prices.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  function startEdit(f: Fee) {
    setEditingId(f.id)
    setNotice(null)
    setForm({
      category_id: f.category_id,
      fee_type: f.fee_type,
      amount: String(Number(f.amount)),
      currency: f.currency,
      valid_from: toKathmanduInputValue(f.valid_from),
      valid_until: toKathmanduInputValue(f.valid_until),
      is_active: f.is_active,
    })
  }

  function resetForm() {
    setEditingId(null)
    setForm((p) => ({ ...EMPTY, currency: p.currency }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!editingId && !form.category_id) {
      setError('Choose a category.')
      return
    }
    const parsed = registrationFeeSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    const body = {
      ...parsed.data,
      valid_from: fromKathmanduInputValue(form.valid_from),
      valid_until: fromKathmanduInputValue(form.valid_until),
    }
    setSaving(true)
    try {
      if (editingId) await api.patch(`/conferences/${conferenceId}/registration-fees/${editingId}`, body)
      else await api.post(`/conferences/${conferenceId}/registration-categories/${form.category_id}/fees`, body)
      resetForm()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this price.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(null)
    try {
      const res = await api.del<{ message: string }>(`/conferences/${conferenceId}/registration-fees/${id}`)
      setNotice(res.message)
      if (editingId === id) resetForm()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this price.')
    }
  }

  const columns: Column<Fee>[] = [
    { key: 'category', header: 'Category', render: (f) => categoryName.get(f.category_id) ?? '—' },
    { key: 'type', header: 'Type', render: (f) => FEE_TYPE_LABELS[f.fee_type] },
    { key: 'amount', header: 'Price', render: (f) => (Number(f.amount) === 0 ? 'Free' : formatMoney(f.amount, f.currency)), className: 'whitespace-nowrap' },
    {
      key: 'window',
      header: 'Valid (Nepal time)',
      render: (f) => (
        <span className="text-xs">
          {formatKathmandu(f.valid_from)} → {formatKathmandu(f.valid_until)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (f) => <StatusChip status={!f.is_active ? 'inactive' : isCurrent(f) ? 'active' : new Date(f.valid_from) > new Date() ? 'scheduled' : 'closed'} />,
    },
    {
      key: 'actions',
      header: '',
      render: (f) => (
        <div className="flex gap-2">
          <Button variant="link" size="sm" onClick={() => startEdit(f)}>
            Edit
          </Button>
          <Button variant="link" size="sm" className="!text-danger" onClick={() => setDeletingId(f.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-brand">Prices</h2>
      <p className="mt-1 text-sm text-text-muted">
        A category without a price is free. Add one price per period (for example early bird, then regular); periods for the same category
        can't overlap. People pay you directly — record each payment from the registrations list below.
      </p>
      {error ? (
        <div className="mt-2">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-2">
          <Alert variant="success">{notice}</Alert>
        </div>
      ) : null}

      <div className="mt-3">
        <Table columns={columns} rows={fees} rowKey={(f) => f.id} loading={loading} emptyTitle="No prices — every category is free." minWidth={760} />
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-surface p-4">
        <FormField label="Category">
          <Select
            value={form.category_id}
            onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}
            disabled={Boolean(editingId)}
            className="w-44"
          >
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Type">
          <Select value={form.fee_type} onChange={(e) => setForm((p) => ({ ...p, fee_type: e.target.value as Fee['fee_type'] }))} className="w-32">
            {FEE_TYPES.map((t) => (
              <option key={t} value={t}>
                {FEE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Amount">
          <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className="w-28" />
        </FormField>
        <FormField label="Currency">
          <Input value={form.currency} maxLength={3} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value.toUpperCase() }))} className="w-20" />
        </FormField>
        <FormField label="From">
          <Input type="datetime-local" value={form.valid_from} onChange={(e) => setForm((p) => ({ ...p, valid_from: e.target.value }))} />
        </FormField>
        <FormField label="Until">
          <Input type="datetime-local" value={form.valid_until} onChange={(e) => setForm((p) => ({ ...p, valid_until: e.target.value }))} />
        </FormField>
        <Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
        <Button type="submit" variant="primary" disabled={saving} loading={saving} iconLeft={<Icon icon={editingId ? Save : Plus} size={16} />}>
          {saving ? 'Saving…' : editingId ? 'Save price' : 'Add price'}
        </Button>
        {editingId ? (
          <Button type="button" variant="secondary" onClick={resetForm}>
            Cancel
          </Button>
        ) : null}
      </form>

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete this price?"
        message="If anyone has already registered under it, it is switched off instead so their record stays correct."
        confirmLabel="Delete price"
        onConfirm={() => deletingId && handleDelete(deletingId)}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  )
}
