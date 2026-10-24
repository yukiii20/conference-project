import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { Alert, Badge, Button, Checkbox, LinkButton, Select } from '../ui'
import { Table } from '../ui/Table'
import type { Column } from '../ui/Table'

type Category = { id: string; name: string }

type BadgeCandidate = {
  registration_id: string
  full_name: string
  affiliation: string | null
  category_name: string
  role_label: 'Speaker' | 'Author' | 'Reviewer' | 'Staff' | 'Attendee'
  checked_in_today: boolean
  printed: boolean
}

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'speaker', label: 'Speaker' },
  { value: 'author', label: 'Author' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'staff', label: 'Staff' },
]

export function PrintBadgesPanel({ conferenceId }: { conferenceId: string }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [candidates, setCandidates] = useState<BadgeCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [categoryId, setCategoryId] = useState('')
  const [role, setRole] = useState('')
  const [checkedInToday, setCheckedInToday] = useState(false)
  const [notPrintedOnly, setNotPrintedOnly] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

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
      if (categoryId) query.category_id = categoryId
      if (role) query.role = role
      if (checkedInToday) query.checked_in_today = '1'
      if (notPrintedOnly) query.not_printed_only = '1'
      const data = await api.get<{ candidates: BadgeCandidate[] }>(`/conferences/${conferenceId}/registrations/badges`, query)
      setCandidates(data.candidates)
      setSelected(new Set())
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load badge candidates.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, categoryId, role, checkedInToday, notPrintedOnly])

  useEffect(() => {
    load()
  }, [load])

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.registration_id))))
  }

  function sheetHref(): string {
    const params = new URLSearchParams()
    if (selected.size > 0) {
      params.set('ids', [...selected].join(','))
    } else {
      if (categoryId) params.set('category_id', categoryId)
      if (role) params.set('role', role)
      if (checkedInToday) params.set('checked_in_today', '1')
      if (notPrintedOnly) params.set('not_printed_only', '1')
    }
    return `${API_BASE}/conferences/${conferenceId}/registrations/badges.pdf?${params.toString()}`
  }

  const columns: Column<BadgeCandidate>[] = [
    {
      key: 'select',
      header: '',
      render: (c) => <Checkbox checked={selected.has(c.registration_id)} onChange={() => toggleRow(c.registration_id)} aria-label={`Select ${c.full_name}`} />,
    },
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <>
          {c.full_name}
          {c.affiliation ? <div className="text-xs text-text-muted">{c.affiliation}</div> : null}
        </>
      ),
    },
    { key: 'category', header: 'Category', render: (c) => c.category_name },
    { key: 'role', header: 'Role', render: (c) => <Badge tone="neutral">{c.role_label}</Badge> },
    { key: 'checked_in', header: 'Checked in today', render: (c) => (c.checked_in_today ? <Badge tone="success">Yes</Badge> : '—') },
    { key: 'printed', header: 'Printed', render: (c) => (c.printed ? <Badge tone="info">Printed</Badge> : '—') },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (c) => (
        <a
          href={`${API_BASE}/conferences/${conferenceId}/registrations/${c.registration_id}/badge.pdf`}
          className="text-sm font-medium text-button underline-offset-2 hover:underline"
        >
          Print
        </a>
      ),
    },
  ]

  return (
    <div>
      <p className="mt-1 text-sm text-text-muted">Generates an A4 sheet of badges with cut marks, or a single badge for one person.</p>
      {error ? (
        <div className="mt-3">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-auto">
          <option value="">Any category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-auto">
          <option value="">Any role</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <Checkbox label="Checked in today" checked={checkedInToday} onChange={(e) => setCheckedInToday(e.target.checked)} />
        <Checkbox label="Not printed yet" checked={notPrintedOnly} onChange={(e) => setNotPrintedOnly(e.target.checked)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={toggleAll} disabled={candidates.length === 0}>
          {selected.size === candidates.length && candidates.length > 0 ? 'Deselect all' : 'Select all'}
        </Button>
        <LinkButton
          href={candidates.length > 0 ? sheetHref() : undefined}
          aria-disabled={candidates.length === 0}
          className={candidates.length === 0 ? 'pointer-events-none opacity-50' : ''}
        >
          {selected.size > 0 ? `Print badges (${selected.size} selected)` : 'Print badges (all shown)'}
        </LinkButton>
      </div>

      <div className="mt-3">
        <Table
          columns={columns}
          rows={candidates}
          rowKey={(c) => c.registration_id}
          loading={loading}
          emptyTitle="No one matches these filters."
          minWidth={760}
        />
      </div>
    </div>
  )
}
