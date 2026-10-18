import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { inviteConvenorSchema, newConferenceSchema, slugify, todayDateString } from '../lib/validation'
import { useNoIndex } from '../lib/noindex'
import { EmailLogTab } from '../components/EmailLogTab'
import { PortalHeader } from '../components/PortalHeader'
import { StatusChip } from '../components/ui/Badge'
import { ConfirmDialog } from '../components/ui/Modal'
import { Pagination } from '../components/ui/Table'

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
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel="Administrator" />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Administrator</h1>

        <div className="mt-6 flex flex-wrap gap-2 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.id ? 'border-button text-button' : 'border-transparent text-ink/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

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

  return (
    <div className="mt-6">
      {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
      {publishError ? <p className="mt-2 text-sm text-red-600">{publishError}</p> : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {showForm ? 'Cancel' : 'New conference'}
        </button>
      </div>

      {createNote ? (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {createNote}
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

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading…</p>
      ) : conferences.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No conferences yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Dates</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Convenor</th>
                <th className="px-4 py-2 font-medium"></th>
                <th className="px-4 py-2 font-medium"></th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {conferences.map((c) => {
                const convenor = convenorByConference[c.id]
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3">{c.code}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(c.start_date)} – {formatDate(c.end_date)}
                    </td>
                    <td className="px-4 py-3">{formatStatus(c.status)}</td>
                    <td className="px-4 py-3">
                      {convenor ? (
                        <span>
                          {convenor.full_name ?? 'Unnamed'}
                          {convenor.email ? ` (${convenor.email})` : ''}
                        </span>
                      ) : (
                        <span className="text-accent">No convenor yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.status === 'draft' ? (
                        <button
                          type="button"
                          onClick={() => handlePublish(c.id)}
                          disabled={publishBusyId === c.id}
                          className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {publishBusyId === c.id ? 'Publishing…' : 'Publish'}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {c.status !== 'draft' ? (
                        <a
                          href={`/c/${c.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background"
                        >
                          Public page
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/super-admin/view-as/${c.id}`}
                        state={{ name: c.name }}
                        className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background"
                      >
                        View as admin
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
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
    <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded-lg border border-line bg-white p-4">
      {formError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {formError}
        </div>
      ) : null}

      <div>
        <label htmlFor="new-name" className="block text-sm font-medium text-ink">
          Name
        </label>
        <input
          id="new-name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.name ? <p className="mt-1 text-sm text-red-600">{errors.name}</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-short-name" className="block text-sm font-medium text-ink">
            Short name
          </label>
          <input
            id="new-short-name"
            value={form.short_name}
            onChange={(e) => update('short_name', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.short_name ? <p className="mt-1 text-sm text-red-600">{errors.short_name}</p> : null}
        </div>
        <div>
          <label htmlFor="new-code" className="block text-sm font-medium text-ink">
            Code
          </label>
          <input
            id="new-code"
            value={form.code}
            onChange={(e) => update('code', e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 uppercase focus:border-button"
          />
          {errors.code ? <p className="mt-1 text-sm text-red-600">{errors.code}</p> : null}
        </div>
      </div>

      <div>
        <label htmlFor="new-slug" className="block text-sm font-medium text-ink">
          Slug
        </label>
        <input
          id="new-slug"
          value={form.slug}
          onChange={(e) => update('slug', e.target.value.toLowerCase())}
          onFocus={() => setSlugTouched(true)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        <p className="mt-1 text-xs text-ink/50">Auto-filled from the short name; edit if you want something different.</p>
        {errors.slug ? <p className="mt-1 text-sm text-red-600">{errors.slug}</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-start" className="block text-sm font-medium text-ink">
            Start date
          </label>
          <input
            id="new-start"
            type="date"
            value={form.start_date}
            min={todayDateString()}
            onChange={(e) => update('start_date', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.start_date ? <p className="mt-1 text-sm text-red-600">{errors.start_date}</p> : null}
        </div>
        <div>
          <label htmlFor="new-end" className="block text-sm font-medium text-ink">
            End date
          </label>
          <input
            id="new-end"
            type="date"
            value={form.end_date}
            min={form.start_date || todayDateString()}
            onChange={(e) => update('end_date', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.end_date ? <p className="mt-1 text-sm text-red-600">{errors.end_date}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="new-city" className="block text-sm font-medium text-ink">
            City
          </label>
          <input
            id="new-city"
            value={form.city}
            onChange={(e) => update('city', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.city ? <p className="mt-1 text-sm text-red-600">{errors.city}</p> : null}
        </div>
        <div>
          <label htmlFor="new-country" className="block text-sm font-medium text-ink">
            Country code
          </label>
          <input
            id="new-country"
            value={form.country}
            onChange={(e) => update('country', e.target.value.toUpperCase())}
            maxLength={2}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 uppercase focus:border-button"
          />
          {errors.country ? <p className="mt-1 text-sm text-red-600">{errors.country}</p> : null}
        </div>
        <div>
          <label htmlFor="new-timezone" className="block text-sm font-medium text-ink">
            Timezone
          </label>
          <input
            id="new-timezone"
            value={form.timezone}
            onChange={(e) => update('timezone', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.timezone ? <p className="mt-1 text-sm text-red-600">{errors.timezone}</p> : null}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create conference'}
      </button>
    </form>
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
      {formError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {formError}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>
      ) : null}

      <div>
        <label htmlFor="cc-conference" className="block text-sm font-medium text-ink">
          Conference
        </label>
        <select
          id="cc-conference"
          value={form.conference_id}
          onChange={(e) => update('conference_id', e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 focus:border-button"
        >
          <option value="">Choose a conference</option>
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
        {errors.conference_id ? <p className="mt-1 text-sm text-red-600">{errors.conference_id}</p> : null}
      </div>

      <div>
        <label htmlFor="cc-name" className="block text-sm font-medium text-ink">
          Full name
        </label>
        <input
          id="cc-name"
          value={form.full_name}
          onChange={(e) => update('full_name', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.full_name ? <p className="mt-1 text-sm text-red-600">{errors.full_name}</p> : null}
      </div>

      <div>
        <label htmlFor="cc-email" className="block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="cc-email"
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.email ? <p className="mt-1 text-sm text-red-600">{errors.email}</p> : null}
      </div>

      <div>
        <label htmlFor="cc-phone" className="block text-sm font-medium text-ink">
          Phone number
        </label>
        <input
          id="cc-phone"
          value={form.phone}
          onChange={(e) => update('phone', e.target.value)}
          placeholder="98XXXXXXXX"
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.phone ? <p className="mt-1 text-sm text-red-600">{errors.phone}</p> : null}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send invitation'}
      </button>

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
      {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
      {success ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>
      ) : null}

      <div>
        <label htmlFor="ac-conference" className="block text-sm font-medium text-ink">
          Conference
        </label>
        <select
          id="ac-conference"
          value={conferenceId}
          onChange={(e) => setConferenceId(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 focus:border-button"
        >
          <option value="">Choose a conference</option>
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ac-search" className="block text-sm font-medium text-ink">
          Search for an account
        </label>
        <input
          id="ac-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {searchError ? <p className="mt-1 text-sm text-red-600">{searchError}</p> : null}
      </div>

      {searching ? <p className="text-sm text-ink/60">Searching…</p> : null}

      {!searching && query.trim().length >= 2 ? (
        results.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
            No matching accounts.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {results.map((profile) => (
              <li key={profile.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{profile.full_name ?? 'Unnamed'}</p>
                  <p className="text-sm text-ink/60">{profile.email ?? 'No email'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleAppoint(profile)}
                  disabled={busyId === profile.id}
                  className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busyId === profile.id ? 'Appointing…' : 'Make convenor'}
                </button>
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

  return (
    <div className="mt-6">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
        className="w-full max-w-md rounded-md border border-line px-3 py-2 focus:border-button"
      />

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {notice ? (
        <div className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading…</p>
      ) : results.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No users found.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {results.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">{p.full_name ?? '—'}</td>
                  <td className="px-4 py-3">{p.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <StatusChip status={p.status ?? 'active'} />
                      {isLocked(p) ? (
                        <span className="inline-block w-fit rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                          Locked until {formatDateTime(p.locked_until!)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">{formatDate(p.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {isLocked(p) ? (
                        <button
                          type="button"
                          onClick={() => handleUnlock(p)}
                          disabled={busyId === p.id}
                          className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background disabled:opacity-50"
                        >
                          Unlock
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleResetPassword(p)}
                        disabled={busyId === p.id}
                        className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background disabled:opacity-50"
                      >
                        Reset password
                      </button>
                      {p.status === 'suspended' || p.status === 'deactivated' ? (
                        <button
                          type="button"
                          onClick={() => handleReactivate(p)}
                          disabled={busyId === p.id}
                          className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSuspend(p)}
                            disabled={busyId === p.id}
                            className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background disabled:opacity-50"
                          >
                            Suspend
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeactivate(p)}
                            disabled={busyId === p.id}
                            className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background disabled:opacity-50"
                          >
                            Deactivate
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setAnonymizeTarget(p)}
                        disabled={busyId === p.id}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Anonymise
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-ink">Anonymise this user?</h2>
        <p className="mt-2 text-sm text-ink/70">
          This permanently replaces {profile.full_name ?? 'this user'}'s name, email, phone and profile photo with
          placeholders, and signs them out everywhere. Their submission and review history is kept. This cannot be
          undone.
        </p>
        <label htmlFor="anonymize-confirm-email" className="mt-4 block text-sm font-medium text-ink">
          Type their email ({profile.email}) to confirm
        </label>
        <input
          id="anonymize-confirm-email"
          value={typedEmail}
          onChange={(e) => setTypedEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(typedEmail)}
            disabled={!matches || busy}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Anonymising…' : 'Anonymise'}
          </button>
        </div>
      </div>
    </div>
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

  if (error) return <p className="mt-6 text-sm text-red-600">{error}</p>
  if (!data) return <p className="mt-6 text-sm text-ink/60">Loading…</p>

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
          <div key={t.label} className="rounded-lg border border-line bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink/50">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold">{t.value}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink">System health</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink/50">Database</p>
            <p className={`mt-1 text-lg font-semibold ${data.health.database.ok ? 'text-green-700' : 'text-red-600'}`}>
              {data.health.database.ok ? `${data.health.database.latency_ms} ms` : 'Down'}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink/50">Email mode</p>
            <p className="mt-1 text-lg font-semibold uppercase">{data.health.email_mode}</p>
          </div>
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink/50">Failed emails (24h)</p>
            <p className={`mt-1 text-lg font-semibold ${data.health.failed_emails_24h > 0 ? 'text-red-600' : ''}`}>
              {data.health.failed_emails_24h}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink/50">Queued emails</p>
            <p className="mt-1 text-lg font-semibold">{data.health.queued_emails}</p>
          </div>
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink/50">Free disk space</p>
            <p className="mt-1 text-lg font-semibold">{formatBytes(data.health.storage_disk.free_bytes)}</p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink">Conferences by status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.conferences_by_status.map((s) => (
            <span key={s.status} className="rounded-full border border-line bg-white px-3 py-1 text-sm">
              {formatStatus(s.status)}: {s.count}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink">Recent activity</h2>
        {data.recent_actions.length === 0 ? (
          <p className="mt-3 text-sm text-ink/60">No activity yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
            {data.recent_actions.map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-sm">
                <span className="text-ink/60">{formatDateTime(a.occurred_at)}</span>
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
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      ) : null}

      <form onSubmit={handleGrant} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line bg-white p-4">
        <div className="flex-1">
          <label htmlFor="grant-admin-email" className="block text-sm font-medium text-ink">
            Add administrator by email
          </label>
          <input
            id="grant-admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            required
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          <p className="mt-1 text-xs text-ink/50">The account must already exist.</p>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add admin'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-ink/60">Loading…</p>
      ) : admins.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No administrators found.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium">{a.full_name}</p>
                <p className="text-sm text-ink/60">{a.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmingRevoke(a)}
                disabled={busyId === a.id}
                className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {busyId === a.id ? 'Removing…' : 'Remove'}
              </button>
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

  if (loading) return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  if (error && !settings) return <p className="mt-6 text-sm text-red-600">{error}</p>
  if (!settings) return null

  return (
    <form onSubmit={handleSave} className="mt-6 max-w-2xl space-y-5">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {saved ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div>
      ) : null}

      <div>
        <label htmlFor="ps-name" className="block text-sm font-medium text-ink">
          Platform name
        </label>
        <input
          id="ps-name"
          value={settings.platform_name}
          onChange={(e) => update('platform_name', e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
      </div>

      <div>
        <label htmlFor="ps-support-email" className="block text-sm font-medium text-ink">
          Support email
        </label>
        <input
          id="ps-support-email"
          type="email"
          value={settings.support_email ?? ''}
          onChange={(e) => update('support_email', e.target.value || null)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
      </div>

      <div>
        <label htmlFor="ps-footer" className="block text-sm font-medium text-ink">
          Footer text
        </label>
        <textarea
          id="ps-footer"
          value={settings.footer_text ?? ''}
          onChange={(e) => update('footer_text', e.target.value || null)}
          rows={2}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
      </div>

      <div>
        <label htmlFor="ps-hero-headline" className="block text-sm font-medium text-ink">
          Home hero heading
        </label>
        <input
          id="ps-hero-headline"
          value={settings.hero_headline ?? ''}
          onChange={(e) => update('hero_headline', e.target.value || null)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
      </div>

      <div>
        <label htmlFor="ps-hero-subheadline" className="block text-sm font-medium text-ink">
          Home hero subtext
        </label>
        <textarea
          id="ps-hero-subheadline"
          value={settings.hero_subheadline ?? ''}
          onChange={(e) => update('hero_subheadline', e.target.value || null)}
          rows={2}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink">FAQ items</p>
          <button
            type="button"
            onClick={addFaqItem}
            className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background"
          >
            Add question
          </button>
        </div>
        <div className="mt-2 space-y-3">
          {settings.faq_items.map((item, i) => (
            <div key={i} className="rounded-lg border border-line bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <label htmlFor={`faq-q-${i}`} className="sr-only">
                  Question {i + 1}
                </label>
                <input
                  id={`faq-q-${i}`}
                  value={item.q}
                  onChange={(e) => updateFaq(i, 'q', e.target.value)}
                  placeholder="Question"
                  className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm focus:border-button"
                />
                <button
                  type="button"
                  onClick={() => removeFaqItem(i)}
                  className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background"
                >
                  Remove
                </button>
              </div>
              <label htmlFor={`faq-a-${i}`} className="sr-only">
                Answer {i + 1}
              </label>
              <textarea
                id={`faq-a-${i}`}
                value={item.a}
                onChange={(e) => updateFaq(i, 'a', e.target.value)}
                placeholder="Answer"
                rows={2}
                className="mt-2 w-full rounded-md border border-line px-3 py-1.5 text-sm focus:border-button"
              />
            </div>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}
