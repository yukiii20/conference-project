import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ExternalLink,
  Eye,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { newConferenceSchema, slugify, todayDateString } from '../../lib/validation'
import {
  Alert,
  Badge,
  Button,
  buttonClasses,
  Card,
  type Column,
  ConfirmDialog,
  FormField,
  Icon,
  Input,
  LinkButton,
  Select,
  StatusChip,
  Table,
} from '../../components/ui'
import { formatDate, formatStatus, type ConferenceRow, type ConvenorInfo } from './shared'

export function ConferencesTab({
  conferences,
  convenorByConference,
  loading,
  loadError,
  onReload,
}: {
  conferences: ConferenceRow[]
  convenorByConference: Record<string, ConvenorInfo>
  loading: boolean
  loadError: string | null
  onReload: () => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [createNote, setCreateNote] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ConferenceRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function handleDelete(conference: ConferenceRow) {
    setDeleteBusy(true)
    setPublishError(null)
    try {
      await api.post(`/admin/conferences/${conference.id}/archive`)
      setPendingDelete(null)
      setCreateNote(`"${conference.name}" was deleted.`)
      await onReload()
    } catch (err) {
      setPendingDelete(null)
      setPublishError(err instanceof ApiError ? err.message : 'Could not delete this conference.')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function handlePublish(id: string) {
    setPublishBusyId(id)
    setPublishError(null)
    try {
      await api.post(`/admin/conferences/${id}/publish`)
      await onReload()
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : 'Could not publish this conference.')
    } finally {
      setPublishBusyId(null)
    }
  }

  const filtered = conferences.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)
  })

  const statusOptions = Array.from(new Set(conferences.map((c) => c.status))).sort()

  const columns: Column<ConferenceRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <div className="flex flex-col">
          <span className="font-medium text-text">{c.name}</span>
          <span className="mt-0.5">
            <Badge tone="neutral">{c.code}</Badge>
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <StatusChip status={c.status} labels={{ registration_open: 'Registration open', submission_open: 'Submission open' }} />,
    },
    {
      key: 'dates',
      header: 'Dates',
      render: (c) => (
        <span className="whitespace-nowrap text-sm">
          {formatDate(c.start_date)} – {formatDate(c.end_date)}
        </span>
      ),
    },
    {
      key: 'convenor',
      header: 'Convenor',
      render: (c) => {
        const convenor = convenorByConference[c.id]
        return convenor ? (
          <div className="flex flex-col">
            <span>{convenor.full_name ?? 'Unnamed'}</span>
            {convenor.email ? <span className="text-xs text-text-muted">{convenor.email}</span> : null}
          </div>
        ) : (
          <span className="text-text-muted">No convenor yet</span>
        )
      },
    },
    {
      key: 'counts',
      header: 'Activity',
      render: (c) => (
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <span className="inline-flex items-center gap-1" title="Submissions">
            <Icon icon={FileText} size={14} />
            {c.submission_count}
          </span>
          <span className="inline-flex items-center gap-1" title="Registrations">
            <Icon icon={Users} size={14} />
            {c.registration_count}
          </span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (c) => (
        <ConferenceRowActions
          conference={c}
          publishBusy={publishBusyId === c.id}
          onPublish={() => handlePublish(c.id)}
          onDelete={() => setPendingDelete(c)}
        />
      ),
    },
  ]

  return (
    <div className="mt-6">
      <div className="space-y-2">
        {loadError ? <Alert variant="danger">{loadError}</Alert> : null}
        {publishError ? <Alert variant="danger">{publishError}</Alert> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon icon={Search} size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, code or slug"
              className="w-64 pl-9"
            />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-48">
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {formatStatus(s)}
              </option>
            ))}
          </Select>
        </div>
        <Button variant={showForm ? 'secondary' : 'primary'} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'New conference'}
        </Button>
      </div>

      {createNote ? (
        <div className="mt-4">
          <Alert variant="success">{createNote}</Alert>
        </div>
      ) : null}

      {showForm ? (
        <NewConferenceForm
          onCreated={async (note) => {
            setShowForm(false)
            setCreateNote(note)
            await onReload()
          }}
        />
      ) : null}

      <div className="mt-4">
        <Table<ConferenceRow>
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          loading={loading}
          emptyTitle={conferences.length === 0 ? 'No conferences yet.' : 'No conferences match this search.'}
          minWidth={820}
        />
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this conference?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed from the public site and this list${
                pendingDelete.submission_count + pendingDelete.registration_count > 0
                  ? ` (it has ${pendingDelete.submission_count} submission(s) and ${pendingDelete.registration_count} registration(s))`
                  : ''
              }. Its data is kept and can be restored from the database if needed.`
            : ''
        }
        confirmLabel="Delete"
        busy={deleteBusy}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

/**
 * The two row-level links (public page, view-as) as proper outline Buttons
 * side by side on a wide screen; collapses into a single "..." menu on a
 * narrow one instead of wrapping the buttons onto a second line (the thing
 * this replaces — see Step 10 spec).
 */
export function ConferenceRowActions({
  conference,
  publishBusy,
  onPublish,
  onDelete,
}: {
  conference: ConferenceRow
  publishBusy: boolean
  onPublish: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const canViewPublicPage = conference.status !== 'draft'

  return (
    <div className="flex items-center justify-end gap-2">
      {conference.status === 'draft' ? (
        <Button size="sm" onClick={onPublish} loading={publishBusy} className="whitespace-nowrap">
          Publish
        </Button>
      ) : null}

      {/* Wide screens: both actions as their own outline buttons. Real <a>/<Link>
          elements styled with buttonClasses — never a <Button> nested inside
          an <a>, which is invalid HTML and muddies the accessible role. */}
      <div className="hidden items-center gap-2 sm:flex">
        {canViewPublicPage ? (
          <LinkButton
            href={`/c/${conference.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm"
            className="whitespace-nowrap"
            iconLeft={<Icon icon={ExternalLink} size={14} />}
          >
            Public page
          </LinkButton>
        ) : null}
        <Link
          to={`/super-admin/view-as/${conference.id}`}
          state={{ name: conference.name }}
          className={buttonClasses('outline', 'sm', 'whitespace-nowrap')}
        >
          <Icon icon={Eye} size={14} />
          View as admin
        </Link>
        <Button
          size="sm"
          variant="outline"
          onClick={onDelete}
          aria-label={`Delete ${conference.name}`}
          title="Delete conference"
          className="whitespace-nowrap !text-danger"
          iconLeft={<Icon icon={Trash2} size={14} />}
        >
          Delete
        </Button>
      </div>

      {/* Narrow screens: one "..." menu instead of the buttons wrapping. */}
      <div ref={menuRef} className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Actions"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
        >
          <Icon icon={MoreHorizontal} size={18} />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-border bg-surface text-text shadow-lg"
          >
            {canViewPublicPage ? (
              <a
                href={`/c/${conference.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-10 items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                <Icon icon={ExternalLink} size={16} />
                Public page
              </a>
            ) : null}
            <Link
              to={`/super-admin/view-as/${conference.id}`}
              state={{ name: conference.name }}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="flex min-h-10 items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-surface-muted"
            >
              <Icon icon={Eye} size={16} />
              View as admin
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              className="flex min-h-10 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-danger hover:bg-surface-muted"
            >
              <Icon icon={Trash2} size={16} />
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const EMPTY_NEW_CONFERENCE = {
  name: '',
  short_name: '',
  code: '',
  slug: '',
  start_date: '',
  end_date: '',
  city: '',
  country: 'NP',
  timezone: 'Asia/Kathmandu',
}

export function NewConferenceForm({ onCreated }: { onCreated: (note: string) => Promise<void> }) {
  const [form, setForm] = useState(EMPTY_NEW_CONFERENCE)
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update<K extends keyof typeof EMPTY_NEW_CONFERENCE>(key: K, value: string) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'short_name' && !slugTouched) {
        next.slug = slugify(value)
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = newConferenceSchema.safeParse(form)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) {
          nextErrors[key] = issue.message
        }
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)

    try {
      await api.post('/admin/conferences', {
        name: parsed.data.name,
        short_name: parsed.data.short_name,
        code: parsed.data.code,
        slug: parsed.data.slug,
        start_date: parsed.data.start_date,
        end_date: parsed.data.end_date,
        city: parsed.data.city,
        country: parsed.data.country,
        timezone: parsed.data.timezone,
      })
      setForm(EMPTY_NEW_CONFERENCE)
      setSlugTouched(false)
      await onCreated('Conference created with default key dates; the convenor can change them in Key dates.')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the conference.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mt-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <FormField label="Name" htmlFor="new-name" error={errors.name}>
          <Input id="new-name" value={form.name} onChange={(e) => update('name', e.target.value)} error={Boolean(errors.name)} />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Short name" htmlFor="new-short-name" error={errors.short_name}>
            <Input
              id="new-short-name"
              value={form.short_name}
              onChange={(e) => update('short_name', e.target.value)}
              error={Boolean(errors.short_name)}
            />
          </FormField>
          <FormField label="Code" htmlFor="new-code" error={errors.code}>
            <Input
              id="new-code"
              value={form.code}
              onChange={(e) => update('code', e.target.value.toUpperCase())}
              className="uppercase"
              error={Boolean(errors.code)}
            />
          </FormField>
        </div>

        <FormField
          label="Slug"
          htmlFor="new-slug"
          help="Auto-filled from the short name; edit if you want something different."
          error={errors.slug}
        >
          <Input
            id="new-slug"
            value={form.slug}
            onChange={(e) => update('slug', e.target.value.toLowerCase())}
            onFocus={() => setSlugTouched(true)}
            error={Boolean(errors.slug)}
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Start date" htmlFor="new-start" error={errors.start_date}>
            <Input
              id="new-start"
              type="date"
              value={form.start_date}
              min={todayDateString()}
              onChange={(e) => update('start_date', e.target.value)}
              error={Boolean(errors.start_date)}
            />
          </FormField>
          <FormField label="End date" htmlFor="new-end" error={errors.end_date}>
            <Input
              id="new-end"
              type="date"
              value={form.end_date}
              min={form.start_date || todayDateString()}
              onChange={(e) => update('end_date', e.target.value)}
              error={Boolean(errors.end_date)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="City" htmlFor="new-city" error={errors.city}>
            <Input id="new-city" value={form.city} onChange={(e) => update('city', e.target.value)} error={Boolean(errors.city)} />
          </FormField>
          <FormField label="Country code" htmlFor="new-country" error={errors.country}>
            <Input
              id="new-country"
              value={form.country}
              onChange={(e) => update('country', e.target.value.toUpperCase())}
              maxLength={2}
              className="uppercase"
              error={Boolean(errors.country)}
            />
          </FormField>
          <FormField label="Timezone" htmlFor="new-timezone" error={errors.timezone}>
            <Input
              id="new-timezone"
              value={form.timezone}
              onChange={(e) => update('timezone', e.target.value)}
              error={Boolean(errors.timezone)}
            />
          </FormField>
        </div>

        <Button type="submit" loading={submitting} iconLeft={<Icon icon={Plus} size={16} />}>
          Create conference
        </Button>
      </form>
    </Card>
  )
}
