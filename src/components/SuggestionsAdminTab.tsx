import { useCallback, useEffect, useState } from 'react'
import { Bug, HelpCircle, Lightbulb, Mail, MessageSquare, Trash2, Eye, Download, type LucideIcon } from 'lucide-react'
import { api, ApiError, API_BASE } from '../lib/api'
import { statusLabel } from '../lib/status'
import { Alert, Button, Card, ConfirmDialog, FormField, Icon, Input, Modal, Select, StatusChip, Table, Pagination, Textarea } from './ui'
import type { Column } from './ui/Table'

type SuggestionCategory = 'feature' | 'bug' | 'question' | 'other'
type SuggestionStatus = 'new' | 'read' | 'in_progress' | 'resolved' | 'archived'

type SuggestionRow = {
  id: string
  name: string | null
  email: string | null
  category: SuggestionCategory
  message: string
  page_url: string | null
  status: SuggestionStatus
  admin_note: string | null
  created_at: string
  updated_at: string
}

const SUGGESTION_STATUSES: SuggestionStatus[] = ['new', 'read', 'in_progress', 'resolved', 'archived']
const SUGGESTION_CATEGORIES: SuggestionCategory[] = ['feature', 'bug', 'question', 'other']

const CATEGORY_META: Record<SuggestionCategory, { label: string; icon: LucideIcon }> = {
  feature: { label: 'Feature', icon: Lightbulb },
  bug: { label: 'Bug', icon: Bug },
  question: { label: 'Question', icon: HelpCircle },
  other: { label: 'Other', icon: MessageSquare },
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function truncate(text: string, max = 70) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

const ICON_BUTTON_CLASSES =
  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-border hover:bg-surface-muted'

/** Super admin "Suggestions" tab — lists, filters, and triages the home page's public suggestion box. */
export function SuggestionsAdminTab({ onCountsChange }: { onCountsChange?: (newCount: number) => void }) {
  const [statusTab, setStatusTab] = useState<SuggestionStatus | 'all'>('all')
  const [category, setCategory] = useState<SuggestionCategory | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<SuggestionRow[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [countsByStatus, setCountsByStatus] = useState<Array<{ status: SuggestionStatus; count: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SuggestionRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{
        suggestions: SuggestionRow[]
        page: number
        page_size: number
        total: number
        counts_by_status: Array<{ status: SuggestionStatus; count: number }>
      }>('/admin/suggestions', {
        status: statusTab === 'all' ? undefined : statusTab,
        category: category || undefined,
        q: query || undefined,
        page: String(page),
      })
      setRows(data.suggestions)
      setTotal(data.total)
      setPageSize(data.page_size)
      setCountsByStatus(data.counts_by_status)
      setError(null)
      onCountsChange?.(data.counts_by_status.find((c) => c.status === 'new')?.count ?? 0)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load suggestions.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTab, category, query, page])

  useEffect(() => {
    load()
  }, [load])

  function changeStatusTab(next: SuggestionStatus | 'all') {
    setStatusTab(next)
    setPage(1)
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    setQuery(searchInput.trim())
    setPage(1)
  }

  async function openDetail(id: string) {
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const data = await api.get<{ suggestion: SuggestionRow }>(`/admin/suggestions/${id}`)
      setDetail(data.suggestion)
      // The GET above may have flipped a NEW suggestion to read server-side — refresh counts/rows to match.
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this suggestion.')
      setDetailId(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleQuickStatus(id: string, status: SuggestionStatus) {
    setBusyId(id)
    try {
      await api.patch(`/admin/suggestions/${id}`, { status })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this suggestion.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleSaveDetail(status: SuggestionStatus, adminNote: string) {
    if (!detailId) return
    setBusyId(detailId)
    try {
      const data = await api.patch<{ suggestion: SuggestionRow }>(`/admin/suggestions/${detailId}`, {
        status,
        admin_note: adminNote,
      })
      setDetail(data.suggestion)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this suggestion.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(null)
    setBusyId(id)
    try {
      await api.del(`/admin/suggestions/${id}`)
      if (detailId === id) {
        setDetailId(null)
        setDetail(null)
      }
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this suggestion.')
    } finally {
      setBusyId(null)
    }
  }

  function exportHref() {
    const params = new URLSearchParams()
    if (statusTab !== 'all') params.set('status', statusTab)
    if (category) params.set('category', category)
    if (query) params.set('q', query)
    const qs = params.toString()
    return `${API_BASE}/admin/suggestions/export.csv${qs ? `?${qs}` : ''}`
  }

  function handleExport() {
    const a = document.createElement('a')
    a.href = exportHref()
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const countFor = (status: SuggestionStatus) => countsByStatus.find((c) => c.status === status)?.count ?? 0
  const allCount = countsByStatus.reduce((sum, c) => sum + c.count, 0)

  const columns: Column<SuggestionRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.created_at)}</span> },
    {
      key: 'category',
      header: 'Category',
      render: (r) => {
        const meta = CATEGORY_META[r.category]
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text">
            <Icon icon={meta.icon} size={14} />
            {meta.label}
          </span>
        )
      },
    },
    {
      key: 'message',
      header: 'Message',
      render: (r) => (
        <button
          type="button"
          onClick={() => openDetail(r.id)}
          className="max-w-[320px] text-left text-text underline-offset-2 hover:text-brand hover:underline"
          title="View full text"
        >
          {truncate(r.message)}
        </button>
      ),
      className: 'max-w-[320px]',
    },
    {
      key: 'from',
      header: 'From',
      render: (r) => (
        <div>
          <p className="text-text">{r.name ?? 'Anonymous'}</p>
          {r.email ? <p className="text-xs text-text-muted">{r.email}</p> : null}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} labels={{ in_progress: 'In progress' }} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Select
            aria-label={`Change status for suggestion from ${r.name ?? 'Anonymous'}`}
            value={r.status}
            disabled={busyId === r.id}
            onChange={(e) => handleQuickStatus(r.id, e.target.value as SuggestionStatus)}
            className="w-auto min-h-9 py-1 text-xs"
          >
            {SUGGESTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'in_progress' ? 'In progress' : statusLabel(s)}
              </option>
            ))}
          </Select>
          <button type="button" aria-label="View full suggestion" onClick={() => openDetail(r.id)} className={ICON_BUTTON_CLASSES}>
            <Icon icon={Eye} size={16} />
          </button>
          {r.email ? (
            <a href={`mailto:${r.email}`} aria-label={`Reply to ${r.email}`} className={ICON_BUTTON_CLASSES}>
              <Icon icon={Mail} size={16} />
            </a>
          ) : null}
          <button
            type="button"
            aria-label="Delete suggestion"
            onClick={() => setConfirmDeleteId(r.id)}
            className={`${ICON_BUTTON_CLASSES} text-danger`}
          >
            <Icon icon={Trash2} size={16} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="mt-6">
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <div role="tablist" className="flex flex-wrap gap-4 overflow-x-auto border-b border-border">
        {(['all', ...SUGGESTION_STATUSES] as const).map((id) => {
          const isActive = statusTab === id
          const count = id === 'all' ? allCount : countFor(id)
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => changeStatusTab(id)}
              className={`flex-shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                isActive ? 'border-brand text-brand' : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {id === 'all' ? 'All' : id === 'in_progress' ? 'In progress' : statusLabel(id)}
              <span className="ml-1.5 text-text-muted/70">({count})</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <FormField label="Category" htmlFor="suggestion-category-filter">
          <Select
            id="suggestion-category-filter"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as SuggestionCategory | '')
              setPage(1)
            }}
            className="w-auto"
          >
            <option value="">All categories</option>
            {SUGGESTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </Select>
        </FormField>

        <form onSubmit={submitSearch} className="flex items-end gap-2">
          <FormField label="Search" htmlFor="suggestion-search">
            <Input
              id="suggestion-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Message, name, or email"
              className="w-56"
            />
          </FormField>
          <Button type="submit" variant="secondary" size="md">
            Search
          </Button>
        </form>

        <Button
          type="button"
          variant="outline"
          size="md"
          className="ml-auto"
          onClick={handleExport}
          iconLeft={<Icon icon={Download} size={16} />}
        >
          Export CSV
        </Button>
      </div>

      <div className="mt-4">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          emptyTitle="No suggestions match."
          minWidth={960}
        />
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />

      <Modal
        open={detailId !== null}
        onClose={() => {
          setDetailId(null)
          setDetail(null)
        }}
        title="Suggestion"
        size="lg"
      >
        {detailLoading || !detail ? (
          <p className="mt-3 text-sm text-text-muted">Loading…</p>
        ) : (
          <SuggestionDetail
            key={detail.id}
            suggestion={detail}
            busy={busyId === detail.id}
            onSave={handleSaveDetail}
            onDelete={() => setConfirmDeleteId(detail.id)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete this suggestion?"
        message="This can't be undone."
        confirmLabel="Delete"
        busy={busyId === confirmDeleteId}
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}

function SuggestionDetail({
  suggestion,
  busy,
  onSave,
  onDelete,
}: {
  suggestion: SuggestionRow
  busy: boolean
  onSave: (status: SuggestionStatus, adminNote: string) => void
  onDelete: () => void
}) {
  const [status, setStatus] = useState<SuggestionStatus>(suggestion.status)
  const [adminNote, setAdminNote] = useState(suggestion.admin_note ?? '')
  const meta = CATEGORY_META[suggestion.category]

  return (
    <div className="mt-3 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text">
          <Icon icon={meta.icon} size={14} />
          {meta.label}
        </span>
        <span className="text-xs text-text-muted">{formatDateTime(suggestion.created_at)}</span>
      </div>

      <div>
        <p className="text-sm font-medium text-text">{suggestion.name ?? 'Anonymous'}</p>
        {suggestion.email ? (
          <a href={`mailto:${suggestion.email}`} className="text-sm text-brand hover:underline">
            {suggestion.email}
          </a>
        ) : null}
        {suggestion.page_url ? <p className="mt-1 text-xs text-text-muted">From: {suggestion.page_url}</p> : null}
      </div>

      <div className="whitespace-pre-wrap rounded-md border border-border bg-page-bg p-3 text-sm text-text">
        {suggestion.message}
      </div>

      <FormField label="Status" htmlFor="suggestion-detail-status">
        <Select id="suggestion-detail-status" value={status} onChange={(e) => setStatus(e.target.value as SuggestionStatus)}>
          {SUGGESTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'in_progress' ? 'In progress' : statusLabel(s)}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Admin note" htmlFor="suggestion-detail-note" help="Internal only — never shown to the sender.">
        <Textarea
          id="suggestion-detail-note"
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </FormField>

      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="danger" size="sm" onClick={onDelete} disabled={busy}>
          Delete
        </Button>
        <Button type="button" loading={busy} onClick={() => onSave(status, adminNote)}>
          Save
        </Button>
      </div>
    </div>
  )
}
