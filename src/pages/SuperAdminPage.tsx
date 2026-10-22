import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { inviteConvenorSchema, newConferenceSchema, slugify, todayDateString } from '../lib/validation'
import { useNoIndex } from '../lib/noindex'
import { EmailLogTab } from '../components/EmailLogTab'
import { PortalHeader } from '../components/PortalHeader'
import {
  Alert,
  Badge,
  Button,
  Card,
  type Column,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  SkeletonText,
  Spinner,
  StatusChip,
  Table,
  Tabs,
  Textarea,
} from '../components/ui'

type AdminTab =
  | 'dashboard'
  | 'conferences'
  | 'create-convenor'
  | 'appoint-convenor'
  | 'users'
  | 'admins'
  | 'settings'
  | 'email-log'

type ConferenceRow = {
  id: string
  name: string
  code: string
  slug: string
  short_name: string | null
  start_date: string
  end_date: string
  status: string
}

type AdminConferenceRow = ConferenceRow & {
  convenor_id: string | null
  convenor_name: string | null
  convenor_email: string | null
}

type ConvenorInfo = {
  full_name: string | null
  email: string | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  status?: 'active' | 'suspended' | 'deactivated'
  failed_login_count?: number
  locked_until?: string | null
  created_at: string
}

type PlatformAdminRow = { id: string; full_name: string; email: string; status: string; granted_at: string }

type DashboardData = {
  conferences_by_status: Array<{ status: string; count: number }>
  archived_conferences: number
  total_users: number
  suspended_users: number
  pending_role_requests: number
  total_submissions: number
  active_registrations: number
  recent_actions: Array<{
    id: number
    occurred_at: string
    actor_name: string | null
    action: string
    entity_type: string
    entity_id: string | null
  }>
  health: {
    database: { ok: boolean; latency_ms: number | null }
    email_mode: string
    failed_emails_24h: number
    queued_emails: number
    storage_disk: { free_bytes: number | null; total_bytes: number | null }
  }
}

type FaqItem = { q: string; a: string }

type PlatformSettings = {
  platform_name: string
  support_email: string | null
  footer_text: string | null
  hero_headline: string | null
  hero_subheadline: string | null
  faq_items: FaqItem[]
}

function formatDate(dateStr: string) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return dateStr
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
}

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'conferences', label: 'Conferences' },
  { id: 'create-convenor', label: 'Create convenor' },
  { id: 'appoint-convenor', label: 'Appoint existing account' },
  { id: 'users', label: 'Users' },
  { id: 'admins', label: 'Admins' },
  { id: 'settings', label: 'Platform settings' },
  { id: 'email-log', label: 'Email log' },
]

export function SuperAdminPage() {
  useNoIndex()
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const [conferences, setConferences] = useState<ConferenceRow[]>([])
  const [convenorByConference, setConvenorByConference] = useState<Record<string, ConvenorInfo>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadConferences = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ conferences: AdminConferenceRow[] }>('/admin/conferences')
      setConferences(data.conferences)

      const map: Record<string, ConvenorInfo> = {}
      for (const row of data.conferences) {
        if (row.convenor_id) map[row.id] = { full_name: row.convenor_name, email: row.convenor_email }
      }
      setConvenorByConference(map)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load conferences.')
      setConferences([])
      setConvenorByConference({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConferences()
  }, [loadConferences])

  return (
    <div className="min-h-screen bg-page-bg text-text">
      <PortalHeader roleLabel="Administrator" />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title="Administrator" />

        <Tabs tabs={TABS} active={tab} onChange={(id) => setTab(id as AdminTab)} />

        {tab === 'dashboard' ? <DashboardTab /> : null}

        {tab === 'conferences' ? (
          <ConferencesTab
            conferences={conferences}
            convenorByConference={convenorByConference}
            loading={loading}
            loadError={loadError}
            onReload={loadConferences}
          />
        ) : null}

        {tab === 'create-convenor' ? (
          <CreateConvenorTab conferences={conferences} convenorByConference={convenorByConference} onReload={loadConferences} />
        ) : null}

        {tab === 'appoint-convenor' ? (
          <AppointConvenorTab conferences={conferences} convenorByConference={convenorByConference} onReload={loadConferences} />
        ) : null}

        {tab === 'users' ? <UsersTab /> : null}
        {tab === 'admins' ? <AdminsTab /> : null}
        {tab === 'settings' ? <PlatformSettingsTab /> : null}
        {tab === 'email-log' ? <EmailLogTab scope="admin" /> : null}
      </main>
    </div>
  )
}

function ConferencesTab({
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

  const columns: Column<ConferenceRow>[] = [
    { key: 'name', header: 'Name', render: (c) => c.name },
    { key: 'code', header: 'Code', render: (c) => c.code },
    {
      key: 'dates',
      header: 'Dates',
      render: (c) => (
        <span className="whitespace-nowrap">
          {formatDate(c.start_date)} – {formatDate(c.end_date)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => formatStatus(c.status) },
    {
      key: 'convenor',
      header: 'Convenor',
      render: (c) => {
        const convenor = convenorByConference[c.id]
        return convenor ? (
          <span>
            {convenor.full_name ?? 'Unnamed'}
            {convenor.email ? ` (${convenor.email})` : ''}
          </span>
        ) : (
          <span className="text-text-muted">No convenor yet</span>
        )
      },
    },
    {
      key: 'publish',
      header: '',
      render: (c) =>
        c.status === 'draft' ? (
          <Button size="sm" onClick={() => handlePublish(c.id)} loading={publishBusyId === c.id}>
            Publish
          </Button>
        ) : null,
    },
    {
      key: 'public-page',
      header: '',
      render: (c) =>
        c.status !== 'draft' ? (
          <a
            href={`/c/${c.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-surface-muted"
          >
            Public page
          </a>
        ) : null,
    },
    {
      key: 'view-as',
      header: '',
      render: (c) => (
        <Link
          to={`/super-admin/view-as/${c.id}`}
          state={{ name: c.name }}
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-surface-muted"
        >
          View as admin
        </Link>
      ),
    },
  ]

  return (
    <div className="mt-6">
      <div className="space-y-2">
        {loadError ? <Alert variant="danger">{loadError}</Alert> : null}
        {publishError ? <Alert variant="danger">{publishError}</Alert> : null}
      </div>

      <div className="mt-4 flex justify-end">
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
          rows={conferences}
          rowKey={(c) => c.id}
          loading={loading}
          emptyTitle="No conferences yet."
          minWidth={720}
        />
      </div>
    </div>
  )
}

const EMPTY_NEW_CONFERENCE = {
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

function NewConferenceForm({ onCreated }: { onCreated: (note: string) => Promise<void> }) {
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

        <Button type="submit" loading={submitting}>
          Create conference
        </Button>
      </form>
    </Card>
  )
}

const EMPTY_INVITE_CONVENOR = {
  conference_id: '',
  full_name: '',
  email: '',
  phone: '',
}

type InviteConvenorResult = { invited: boolean; appointed: boolean }

function CreateConvenorTab({
  conferences,
  convenorByConference,
  onReload,
}: {
  conferences: ConferenceRow[]
  convenorByConference: Record<string, ConvenorInfo>
  onReload: () => Promise<void>
}) {
  const [form, setForm] = useState(EMPTY_INVITE_CONVENOR)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingReplace, setPendingReplace] = useState<{
    data: ReturnType<typeof inviteConvenorSchema.parse>
    currentName: string
  } | null>(null)

  function update<K extends keyof typeof EMPTY_INVITE_CONVENOR>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSuccess(null)

    const parsed = inviteConvenorSchema.safeParse(form)
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

    const current = convenorByConference[parsed.data.conference_id]
    if (current) {
      setPendingReplace({ data: parsed.data, currentName: current.full_name ?? current.email ?? '' })
      return
    }
    performInvite(parsed.data)
  }

  async function performInvite(parsedData: ReturnType<typeof inviteConvenorSchema.parse>) {
    const parsed = { data: parsedData }
    setPendingReplace(null)
    setSubmitting(true)

    try {
      const result = await api.post<InviteConvenorResult>(
        `/admin/conferences/${parsed.data.conference_id}/convenor-invite`,
        {
          full_name: parsed.data.full_name,
          email: parsed.data.email,
          phone: parsed.data.phone,
        },
      )

      const conference = conferences.find((c) => c.id === parsed.data.conference_id)
      const conferenceName = conference?.name ?? 'the conference'

      setSuccess(
        result.invited
          ? `Invitation sent to ${parsed.data.email}. They will set their own password from the email.`
          : `${parsed.data.full_name} already has an account and is now the convenor of ${conferenceName}.`,
      )
      setForm(EMPTY_INVITE_CONVENOR)
      await onReload()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not invite this convenor.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-lg space-y-4">
      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <FormField label="Conference" htmlFor="cc-conference" error={errors.conference_id}>
        <Select
          id="cc-conference"
          value={form.conference_id}
          onChange={(e) => update('conference_id', e.target.value)}
          error={Boolean(errors.conference_id)}
        >
          <option value="">Choose a conference</option>
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Full name" htmlFor="cc-name" error={errors.full_name}>
        <Input id="cc-name" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} error={Boolean(errors.full_name)} />
      </FormField>

      <FormField label="Email" htmlFor="cc-email" error={errors.email}>
        <Input
          id="cc-email"
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          error={Boolean(errors.email)}
        />
      </FormField>

      <FormField label="Phone number" htmlFor="cc-phone" error={errors.phone}>
        <Input
          id="cc-phone"
          value={form.phone}
          onChange={(e) => update('phone', e.target.value)}
          placeholder="98XXXXXXXX"
          error={Boolean(errors.phone)}
        />
      </FormField>

      <Button type="submit" loading={submitting}>
        Send invitation
      </Button>

      <ConfirmDialog
        open={pendingReplace !== null}
        title="Replace the current convenor?"
        message={
          pendingReplace
            ? `Replace ${pendingReplace.currentName} with ${pendingReplace.data.full_name}?`
            : ''
        }
        confirmLabel="Replace"
        confirmVariant="primary"
        busy={submitting}
        onConfirm={() => pendingReplace && performInvite(pendingReplace.data)}
        onCancel={() => setPendingReplace(null)}
      />
    </form>
  )
}

function AppointConvenorTab({
  conferences,
  convenorByConference,
  onReload,
}: {
  conferences: ConferenceRow[]
  convenorByConference: Record<string, ConvenorInfo>
  onReload: () => Promise<void>
}) {
  const [conferenceId, setConferenceId] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileRow[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingAppoint, setPendingAppoint] = useState<{ profile: ProfileRow; currentName: string } | null>(null)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const data = await api.get<{ users: ProfileRow[] }>('/admin/users', { query: term })
        if (cancelled) return
        setResults(data.users)
        setSearchError(null)
      } catch (err) {
        if (cancelled) return
        setSearchError(err instanceof ApiError ? err.message : 'Could not search.')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  function handleAppoint(profile: ProfileRow) {
    setActionError(null)
    setSuccess(null)

    if (!conferenceId) {
      setActionError('Choose a conference first.')
      return
    }
    if (!profile.email) {
      setActionError('This account has no email on file.')
      return
    }

    const current = convenorByConference[conferenceId]
    if (current) {
      setPendingAppoint({ profile, currentName: current.full_name ?? current.email ?? '' })
      return
    }
    performAppoint(profile)
  }

  async function performAppoint(profile: ProfileRow) {
    setPendingAppoint(null)
    setBusyId(profile.id)
    try {
      await api.post(`/admin/conferences/${conferenceId}/convenor`, { email: profile.email })
      const conference = conferences.find((c) => c.id === conferenceId)
      setSuccess(`${profile.full_name ?? profile.email} is now the convenor of ${conference?.name ?? 'the conference'}.`)
      await onReload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not appoint this convenor.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-6 max-w-2xl space-y-4">
      {actionError ? <Alert variant="danger">{actionError}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <FormField label="Conference" htmlFor="ac-conference">
        <Select id="ac-conference" value={conferenceId} onChange={(e) => setConferenceId(e.target.value)}>
          <option value="">Choose a conference</option>
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Search for an account" htmlFor="ac-search" error={searchError ?? undefined}>
        <Input id="ac-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" />
      </FormField>

      {searching ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Spinner size="sm" /> Searching…
        </div>
      ) : null}

      {!searching && query.trim().length >= 2 ? (
        results.length === 0 ? (
          <Card>
            <EmptyState title="No matching accounts." />
          </Card>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {results.map((profile) => (
              <li key={profile.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-text">{profile.full_name ?? 'Unnamed'}</p>
                  <p className="text-sm text-text-muted">{profile.email ?? 'No email'}</p>
                </div>
                <Button size="sm" onClick={() => handleAppoint(profile)} disabled={busyId === profile.id}>
                  Make convenor
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <ConfirmDialog
        open={pendingAppoint !== null}
        title="Replace the current convenor?"
        message={
          pendingAppoint
            ? `Replace ${pendingAppoint.currentName} with ${pendingAppoint.profile.full_name ?? pendingAppoint.profile.email}?`
            : ''
        }
        confirmLabel="Replace"
        confirmVariant="primary"
        busy={busyId === pendingAppoint?.profile.id}
        onConfirm={() => pendingAppoint && performAppoint(pendingAppoint.profile)}
        onCancel={() => setPendingAppoint(null)}
      />
    </div>
  )
}

function isLocked(p: ProfileRow): boolean {
  return Boolean(p.locked_until && new Date(p.locked_until).getTime() > Date.now())
}

function UsersTab() {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

function AnonymizeConfirmDialog({
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

function DashboardTab() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await api.get<DashboardData>('/admin/dashboard')
        if (!cancelled) {
          setData(res)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="mt-6">
        <ErrorState message={error} />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mt-6">
        <SkeletonText lines={5} />
      </div>
    )
  }

  const tiles: Array<{ label: string; value: number }> = [
    { label: 'Total users', value: data.total_users },
    { label: 'Suspended users', value: data.suspended_users },
    { label: 'Pending role requests', value: data.pending_role_requests },
    { label: 'Total submissions', value: data.total_submissions },
    { label: 'Active registrations', value: data.active_registrations },
    { label: 'Archived conferences', value: data.archived_conferences },
  ]

  return (
    <div className="mt-6 space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label}>
            <p className="text-xs uppercase tracking-wide text-text-muted">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold text-text">{t.value}</p>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-text">System health</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Card>
            <p className="text-xs uppercase tracking-wide text-text-muted">Database</p>
            <div className="mt-1">
              <Badge tone={data.health.database.ok ? 'success' : 'danger'}>
                {data.health.database.ok ? `${data.health.database.latency_ms} ms` : 'Down'}
              </Badge>
            </div>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-text-muted">Email mode</p>
            <p className="mt-1 text-lg font-semibold uppercase text-text">{data.health.email_mode}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-text-muted">Failed emails (24h)</p>
            <div className="mt-1">
              <Badge tone={data.health.failed_emails_24h > 0 ? 'danger' : 'neutral'}>
                {data.health.failed_emails_24h}
              </Badge>
            </div>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-text-muted">Queued emails</p>
            <p className="mt-1 text-lg font-semibold text-text">{data.health.queued_emails}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-text-muted">Free disk space</p>
            <p className="mt-1 text-lg font-semibold text-text">{formatBytes(data.health.storage_disk.free_bytes)}</p>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-text">Conferences by status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.conferences_by_status.map((s) => (
            <Badge key={s.status} tone="neutral">
              {formatStatus(s.status)}: {s.count}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-text">Recent activity</h2>
        {data.recent_actions.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No activity yet." />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {data.recent_actions.map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-sm">
                <span className="text-text-muted">{formatDateTime(a.occurred_at)}</span>
                {' — '}
                <span className="font-medium">{a.actor_name ?? 'System'}</span> {a.action}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AdminsTab() {
  const [admins, setAdmins] = useState<PlatformAdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingRevoke, setConfirmingRevoke] = useState<PlatformAdminRow | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ admins: PlatformAdminRow[] }>('/admin/admins')
      setAdmins(data.admins)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load administrators.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await api.post('/admin/admins', { email: email.trim() })
      setNotice(`${email.trim()} is now a platform administrator.`)
      setEmail('')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not grant administrator access.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(admin: PlatformAdminRow) {
    setConfirmingRevoke(null)
    setBusyId(admin.id)
    setError(null)
    setNotice(null)
    try {
      await api.del(`/admin/admins/${admin.id}`)
      setNotice(`Administrator access removed from ${admin.email}.`)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove administrator access.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-6 max-w-2xl space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <Card>
        <form onSubmit={handleGrant} className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <FormField label="Add administrator by email" htmlFor="grant-admin-email" help="The account must already exist.">
              <Input
                id="grant-admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
                required
              />
            </FormField>
          </div>
          <Button type="submit" loading={submitting}>
            Add admin
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Spinner size="sm" /> Loading…
        </div>
      ) : admins.length === 0 ? (
        <Card>
          <EmptyState title="No administrators found." />
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-text">{a.full_name}</p>
                <p className="text-sm text-text-muted">{a.email}</p>
              </div>
              <Button variant="danger" size="sm" onClick={() => setConfirmingRevoke(a)} disabled={busyId === a.id}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmingRevoke !== null}
        title="Remove administrator access?"
        message={confirmingRevoke ? `Remove administrator access from ${confirmingRevoke.full_name} (${confirmingRevoke.email})?` : ''}
        confirmLabel="Remove access"
        busy={busyId === confirmingRevoke?.id}
        onConfirm={() => confirmingRevoke && handleRevoke(confirmingRevoke)}
        onCancel={() => setConfirmingRevoke(null)}
      />
    </div>
  )
}

function PlatformSettingsTab() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await api.get<{ settings: PlatformSettings }>('/admin/platform-settings')
        if (!cancelled) {
          setSettings(data.settings)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load platform settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function update<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  function updateFaq(index: number, field: keyof FaqItem, value: string) {
    setSettings((prev) => {
      if (!prev) return prev
      const faq_items = prev.faq_items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
      return { ...prev, faq_items }
    })
    setSaved(false)
  }

  function addFaqItem() {
    setSettings((prev) => (prev ? { ...prev, faq_items: [...prev.faq_items, { q: '', a: '' }] } : prev))
  }

  function removeFaqItem(index: number) {
    setSettings((prev) => (prev ? { ...prev, faq_items: prev.faq_items.filter((_, i) => i !== index) } : prev))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const data = await api.patch<{ settings: PlatformSettings }>('/admin/platform-settings', settings)
      setSettings(data.settings)
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save platform settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6">
        <SkeletonText lines={6} />
      </div>
    )
  }
  if (error && !settings) {
    return (
      <div className="mt-6">
        <ErrorState message={error} />
      </div>
    )
  }
  if (!settings) return null

  return (
    <form onSubmit={handleSave} className="mt-6 max-w-2xl space-y-5">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {saved ? <Alert variant="success">Saved.</Alert> : null}

      <FormField label="Platform name" htmlFor="ps-name">
        <Input id="ps-name" value={settings.platform_name} onChange={(e) => update('platform_name', e.target.value)} required />
      </FormField>

      <FormField label="Support email" htmlFor="ps-support-email">
        <Input
          id="ps-support-email"
          type="email"
          value={settings.support_email ?? ''}
          onChange={(e) => update('support_email', e.target.value || null)}
        />
      </FormField>

      <FormField label="Footer text" htmlFor="ps-footer">
        <Textarea
          id="ps-footer"
          value={settings.footer_text ?? ''}
          onChange={(e) => update('footer_text', e.target.value || null)}
          rows={2}
        />
      </FormField>

      <FormField label="Home hero heading" htmlFor="ps-hero-headline">
        <Input
          id="ps-hero-headline"
          value={settings.hero_headline ?? ''}
          onChange={(e) => update('hero_headline', e.target.value || null)}
        />
      </FormField>

      <FormField label="Home hero subtext" htmlFor="ps-hero-subheadline">
        <Textarea
          id="ps-hero-subheadline"
          value={settings.hero_subheadline ?? ''}
          onChange={(e) => update('hero_subheadline', e.target.value || null)}
          rows={2}
        />
      </FormField>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text">FAQ items</p>
          <Button variant="secondary" size="sm" type="button" onClick={addFaqItem}>
            Add question
          </Button>
        </div>
        <div className="mt-2 space-y-3">
          {settings.faq_items.map((item, i) => (
            <Card key={i}>
              <div className="flex items-start justify-between gap-2">
                <label htmlFor={`faq-q-${i}`} className="sr-only">
                  Question {i + 1}
                </label>
                <Input
                  id={`faq-q-${i}`}
                  value={item.q}
                  onChange={(e) => updateFaq(i, 'q', e.target.value)}
                  placeholder="Question"
                  className="flex-1"
                />
                <Button variant="secondary" size="sm" type="button" onClick={() => removeFaqItem(i)}>
                  Remove
                </Button>
              </div>
              <label htmlFor={`faq-a-${i}`} className="sr-only">
                Answer {i + 1}
              </label>
              <Textarea
                id={`faq-a-${i}`}
                value={item.a}
                onChange={(e) => updateFaq(i, 'a', e.target.value)}
                placeholder="Answer"
                rows={2}
                className="mt-2"
              />
            </Card>
          ))}
        </div>
      </div>

      <Button type="submit" loading={saving}>
        Save settings
      </Button>
    </form>
  )
}
