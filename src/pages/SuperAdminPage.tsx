import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { inviteConvenorSchema, newConferenceSchema, slugify, todayDateString } from '../lib/validation'
import { useNoIndex } from '../lib/noindex'
import { PortalHeader } from '../components/PortalHeader'

type AdminTab = 'conferences' | 'create-convenor' | 'appoint-convenor' | 'users'

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

type ConvenorInfo = {
  full_name: string | null
  email: string | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  created_at: string
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

function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
}

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'conferences', label: 'Conferences' },
  { id: 'create-convenor', label: 'Create convenor' },
  { id: 'appoint-convenor', label: 'Appoint existing account' },
  { id: 'users', label: 'Users' },
]

export function SuperAdminPage() {
  useNoIndex()
  const [tab, setTab] = useState<AdminTab>('conferences')
  const [conferences, setConferences] = useState<ConferenceRow[]>([])
  const [convenorByConference, setConvenorByConference] = useState<Record<string, ConvenorInfo>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadConferences = useCallback(async () => {
    setLoading(true)
    const [{ data: confData, error: confError }, { data: memberData, error: memberError }] = await Promise.all([
      supabase
        .from('conferences')
        .select('id, name, code, slug, short_name, start_date, end_date, status')
        .order('created_at', { ascending: false }),
      supabase
        .from('conference_members')
        .select('conference_id, profiles!conference_members_user_id_fkey(full_name, email)')
        .eq('role_code', 'convenor')
        .eq('status', 'active'),
    ])

    if (confError) {
      setLoadError(confError.message)
      setConferences([])
      setLoading(false)
      return
    }

    setConferences((confData ?? []) as ConferenceRow[])

    if (memberError) {
      setLoadError(memberError.message)
      setConvenorByConference({})
    } else {
      const map: Record<string, ConvenorInfo> = {}
      for (const row of (memberData ?? []) as Array<{
        conference_id: string
        profiles: ConvenorInfo | ConvenorInfo[] | null
      }>) {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
        if (profile) map[row.conference_id] = profile
      }
      setConvenorByConference(map)
      setLoadError(null)
    }

    setLoading(false)
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
    const { error } = await supabase.from('conferences').update({ status: 'submission_open' }).eq('id', id)
    setPublishBusyId(null)
    if (error) {
      setPublishError(error.message)
      return
    }
    await onReload()
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

/** Default key-dates window applied to every new conference: deadline_type -> days from now the window closes. */
const DEFAULT_DEADLINE_OFFSETS: Array<{ deadline_type: string; closes_in_days: number }> = [
  { deadline_type: 'registration', closes_in_days: 60 },
  { deadline_type: 'abstract_submission', closes_in_days: 30 },
  { deadline_type: 'review', closes_in_days: 45 },
  { deadline_type: 'full_paper', closes_in_days: 55 },
  { deadline_type: 'final_paper', closes_in_days: 58 },
]

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

    const { data: userData } = await supabase.auth.getUser()

    const { data: inserted, error } = await supabase
      .from('conferences')
      .insert({
        name: parsed.data.name,
        short_name: parsed.data.short_name,
        code: parsed.data.code,
        slug: parsed.data.slug,
        start_date: parsed.data.start_date,
        end_date: parsed.data.end_date,
        city: parsed.data.city,
        country: parsed.data.country,
        timezone: parsed.data.timezone,
        status: 'draft',
        social_links: {},
        created_by: userData.user?.id ?? null,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      setSubmitting(false)
      setFormError(error?.message ?? 'Could not create the conference.')
      return
    }

    const now = new Date()
    const deadlineRows = DEFAULT_DEADLINE_OFFSETS.map((d) => ({
      conference_id: inserted.id,
      deadline_type: d.deadline_type,
      opens_at: now.toISOString(),
      closes_at: new Date(now.getTime() + d.closes_in_days * 24 * 60 * 60 * 1000).toISOString(),
    }))
    const { error: deadlinesError } = await supabase.from('conference_deadlines').insert(deadlineRows)

    setSubmitting(false)
    setForm(EMPTY_NEW_CONFERENCE)
    setSlugTouched(false)

    await onCreated(
      deadlinesError
        ? `Conference created. Could not create default key dates (${deadlinesError.message}) — set them in Key dates.`
        : 'Default key dates created; the convenor can change them in Key dates.',
    )
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

      <div className="grid grid-cols-2 gap-4">
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

      <div className="grid grid-cols-2 gap-4">
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

      <div className="grid grid-cols-3 gap-4">
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

async function readFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: Response }).context
  if (context) {
    try {
      const body = await context.json()
      if (body && typeof body.error === 'string') return body.error
    } catch {
      // fall through to fallback
    }
  }
  return (error as { message?: string }).message ?? fallback
}

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

  function update<K extends keyof typeof EMPTY_INVITE_CONVENOR>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
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
      const ok = window.confirm(`Replace ${current.full_name ?? current.email} with ${parsed.data.full_name}?`)
      if (!ok) return
    }

    setSubmitting(true)

    const { data, error } = await supabase.functions.invoke('invite-convenor', {
      body: {
        conference_id: parsed.data.conference_id,
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        phone: parsed.data.phone,
      },
    })

    setSubmitting(false)

    if (error) {
      setFormError(await readFunctionErrorMessage(error, 'Could not invite this convenor.'))
      return
    }

    const result = data as InviteConvenorResult
    const conference = conferences.find((c) => c.id === parsed.data.conference_id)
    const conferenceName = conference?.name ?? 'the conference'

    setSuccess(
      result.invited
        ? `Invitation sent to ${parsed.data.email}. They will set their own password from the email.`
        : `${parsed.data.full_name} already has an account and is now the convenor of ${conferenceName}.`,
    )
    setForm(EMPTY_INVITE_CONVENOR)
    await onReload()
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
      const safe = term.replace(/[,()%]/g, '')
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, created_at')
        .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`)
        .limit(20)
      if (cancelled) return
      setSearching(false)
      if (error) {
        setSearchError(error.message)
      } else {
        setResults((data ?? []) as ProfileRow[])
        setSearchError(null)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  async function handleAppoint(profile: ProfileRow) {
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
      const ok = window.confirm(
        `Replace ${current.full_name ?? current.email} with ${profile.full_name ?? profile.email}?`,
      )
      if (!ok) return
    }

    setBusyId(profile.id)
    const { error } = await supabase.rpc('appoint_convenor', {
      p_conference_id: conferenceId,
      p_email: profile.email,
    })
    setBusyId(null)

    if (error) {
      setActionError(error.message)
      return
    }

    const conference = conferences.find((c) => c.id === conferenceId)
    setSuccess(`${profile.full_name ?? profile.email} is now the convenor of ${conference?.name ?? 'the conference'}.`)
    await onReload()
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
    </div>
  )
}

function UsersTab() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const handle = setTimeout(async () => {
      const term = query.trim().replace(/[,()%]/g, '')
      const base = supabase
        .from('profiles')
        .select('id, full_name, email, phone, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      const { data, error: err } = term ? await base.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`) : await base
      if (cancelled) return
      setLoading(false)
      if (err) {
        setError(err.message)
      } else {
        setResults((data ?? []) as ProfileRow[])
        setError(null)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  return (
    <div className="mt-6">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
        className="w-full max-w-md rounded-md border border-line px-3 py-2 focus:border-button"
      />

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading…</p>
      ) : results.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No users found.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {results.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">{p.full_name ?? '—'}</td>
                  <td className="px-4 py-3">{p.email ?? '—'}</td>
                  <td className="px-4 py-3">{p.phone ?? '—'}</td>
                  <td className="px-4 py-3">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
