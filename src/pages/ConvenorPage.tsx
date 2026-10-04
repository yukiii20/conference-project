import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getRoleDefinition } from '../lib/roles'
import { conferenceInfoSchema } from '../lib/validation'
import type { MyRoleRow, RoleRequestForReview, RoleRequestStatus } from '../lib/types'

const TABS: RoleRequestStatus[] = ['pending', 'approved', 'rejected']

type PageView = 'requests' | 'conference'

type ConferenceFormState = {
  code: string
  name: string
  short_name: string
  theme: string
  description: string
  venue_name: string
  address: string
  city: string
  country: string
  contact_email: string
  contact_phone: string
  website_url: string
}

const EMPTY_CONFERENCE_FORM: ConferenceFormState = {
  code: '',
  name: '',
  short_name: '',
  theme: '',
  description: '',
  venue_name: '',
  address: '',
  city: '',
  country: 'NP',
  contact_email: '',
  contact_phone: '',
  website_url: '',
}

function ConferenceInfoTab({ conferenceId }: { conferenceId: string }) {
  const [form, setForm] = useState<ConferenceFormState>(EMPTY_CONFERENCE_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('conferences')
        .select(
          'code, name, short_name, theme, description, venue_name, address, city, country, contact_email, contact_phone, website_url',
        )
        .eq('id', conferenceId)
        .single()

      if (cancelled) return

      if (error) {
        setFormError(error.message)
      } else if (data) {
        setForm({
          code: data.code ?? '',
          name: data.name ?? '',
          short_name: data.short_name ?? '',
          theme: data.theme ?? '',
          description: data.description ?? '',
          venue_name: data.venue_name ?? '',
          address: data.address ?? '',
          city: data.city ?? '',
          country: data.country ?? 'NP',
          contact_email: data.contact_email ?? '',
          contact_phone: data.contact_phone ?? '',
          website_url: data.website_url ?? '',
        })
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  function update<K extends keyof ConferenceFormState>(key: K, value: ConferenceFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaved(false)

    const parsed = conferenceInfoSchema.safeParse(form)
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

    setSaving(true)
    const {
      code,
      name,
      short_name,
      theme,
      description,
      venue_name,
      address,
      city,
      country,
      contact_email,
      contact_phone,
      website_url,
    } = parsed.data
    const { error } = await supabase
      .from('conferences')
      .update({
        code,
        name,
        short_name,
        theme,
        description,
        venue_name,
        address,
        city,
        country,
        contact_email,
        contact_phone,
        website_url,
      })
      .eq('id', conferenceId)
    setSaving(false)

    if (error) {
      setFormError(error.message)
      return
    }
    setSaved(true)
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-4">
      {formError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {formError}
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Saved.
        </div>
      ) : null}

      <div>
        <label htmlFor="code" className="block text-sm font-medium text-ink">
          Conference code
        </label>
        <input
          id="code"
          value={form.code}
          onChange={(e) => update('code', e.target.value.toUpperCase())}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 uppercase focus:border-button"
        />
        <p className="mt-1 text-xs text-ink/50">Used in sign-up and the public page URL. Changing it won't update old links.</p>
        {errors.code ? <p className="mt-1 text-sm text-red-600">{errors.code}</p> : null}
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-ink">
          Name
        </label>
        <input
          id="name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.name ? <p className="mt-1 text-sm text-red-600">{errors.name}</p> : null}
      </div>

      <div>
        <label htmlFor="short_name" className="block text-sm font-medium text-ink">
          Short name
        </label>
        <input
          id="short_name"
          value={form.short_name}
          onChange={(e) => update('short_name', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.short_name ? <p className="mt-1 text-sm text-red-600">{errors.short_name}</p> : null}
      </div>

      <div>
        <label htmlFor="theme" className="block text-sm font-medium text-ink">
          Theme
        </label>
        <input
          id="theme"
          value={form.theme}
          onChange={(e) => update('theme', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.theme ? <p className="mt-1 text-sm text-red-600">{errors.theme}</p> : null}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-ink">
          About the conference
        </label>
        <textarea
          id="description"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          rows={6}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.description ? <p className="mt-1 text-sm text-red-600">{errors.description}</p> : null}
      </div>

      <div>
        <label htmlFor="venue_name" className="block text-sm font-medium text-ink">
          Venue
        </label>
        <input
          id="venue_name"
          value={form.venue_name}
          onChange={(e) => update('venue_name', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.venue_name ? <p className="mt-1 text-sm text-red-600">{errors.venue_name}</p> : null}
      </div>

      <div>
        <label htmlFor="address" className="block text-sm font-medium text-ink">
          Address
        </label>
        <input
          id="address"
          value={form.address}
          onChange={(e) => update('address', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.address ? <p className="mt-1 text-sm text-red-600">{errors.address}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="city" className="block text-sm font-medium text-ink">
            City
          </label>
          <input
            id="city"
            value={form.city}
            onChange={(e) => update('city', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.city ? <p className="mt-1 text-sm text-red-600">{errors.city}</p> : null}
        </div>
        <div>
          <label htmlFor="country" className="block text-sm font-medium text-ink">
            Country code
          </label>
          <input
            id="country"
            value={form.country}
            onChange={(e) => update('country', e.target.value)}
            maxLength={2}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 uppercase focus:border-button"
          />
          {errors.country ? <p className="mt-1 text-sm text-red-600">{errors.country}</p> : null}
        </div>
      </div>

      <div>
        <label htmlFor="contact_email" className="block text-sm font-medium text-ink">
          Contact email
        </label>
        <input
          id="contact_email"
          type="email"
          value={form.contact_email}
          onChange={(e) => update('contact_email', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.contact_email ? <p className="mt-1 text-sm text-red-600">{errors.contact_email}</p> : null}
      </div>

      <div>
        <label htmlFor="contact_phone" className="block text-sm font-medium text-ink">
          Contact phone
        </label>
        <input
          id="contact_phone"
          value={form.contact_phone}
          onChange={(e) => update('contact_phone', e.target.value)}
          placeholder="98XXXXXXXX"
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.contact_phone ? <p className="mt-1 text-sm text-red-600">{errors.contact_phone}</p> : null}
      </div>

      <div>
        <label htmlFor="website_url" className="block text-sm font-medium text-ink">
          Website
        </label>
        <input
          id="website_url"
          value={form.website_url}
          onChange={(e) => update('website_url', e.target.value)}
          placeholder="https://"
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.website_url ? <p className="mt-1 text-sm text-red-600">{errors.website_url}</p> : null}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}

export function ConvenorPage() {
  const navigate = useNavigate()
  const [userName, setUserName] = useState('')
  const [conferenceId, setConferenceId] = useState<string | null>(null)
  const [conferenceName, setConferenceName] = useState('')
  const [view, setView] = useState<PageView>('requests')
  const [tab, setTab] = useState<RoleRequestStatus>('pending')
  const [requests, setRequests] = useState<RoleRequestForReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadRequests = useCallback(async (confId: string) => {
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('get_role_requests', {
      p_conference_id: confId,
    })
    if (rpcError) {
      setError(rpcError.message)
    } else {
      setRequests((data ?? []) as RoleRequestForReview[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return

      const [{ data: profile }, { data: rolesData }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', userData.user.id).single(),
        supabase.rpc('get_my_roles'),
      ])

      if (cancelled) return
      setUserName(profile?.full_name ?? userData.user.email ?? '')

      const roles = (rolesData ?? []) as MyRoleRow[]
      const convenorRole = roles.find((r) => r.role_code === 'convenor' && r.conference_id)

      if (convenorRole?.conference_id) {
        setConferenceId(convenorRole.conference_id)
        setConferenceName(convenorRole.conference_name ?? '')
        await loadRequests(convenorRole.conference_id)
      } else {
        setLoading(false)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [loadRequests])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  async function handleApprove(id: string) {
    if (!window.confirm('Approve this request?')) return
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('review_role_request', {
      p_request_id: id,
      p_approve: true,
    })
    setBusyId(null)
    if (rpcError) {
      setError(rpcError.message)
    } else if (conferenceId) {
      await loadRequests(conferenceId)
    }
  }

  function startReject(id: string) {
    setRejectingId(id)
    setReason('')
    setError(null)
  }

  async function confirmReject(id: string) {
    if (reason.trim().length < 3) {
      setError('Please give a short reason.')
      return
    }
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('review_role_request', {
      p_request_id: id,
      p_approve: false,
      p_reason: reason.trim(),
    })
    setBusyId(null)
    if (rpcError) {
      setError(rpcError.message)
    } else {
      setRejectingId(null)
      if (conferenceId) await loadRequests(conferenceId)
    }
  }

  const filtered = requests.filter((r) => r.status === tab)

  return (
    <div className="min-h-screen bg-background text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-button px-4 py-3 text-white">
        <span className="font-semibold">Conference management system</span>
        <div className="flex items-center gap-3 text-sm">
          <span>{userName}</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">Convenor</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-white/40 px-3 py-1 hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Convenor</h1>
        {conferenceName ? <p className="mt-1 text-ink/70">{conferenceName}</p> : null}

        {!conferenceId ? (
          <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
            You are not set up as convenor of any conference yet.
          </p>
        ) : (
          <>
            <div className="mt-6 flex gap-2 border-b border-line">
              <button
                type="button"
                onClick={() => setView('requests')}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  view === 'requests' ? 'border-button text-button' : 'border-transparent text-ink/60'
                }`}
              >
                Role requests
              </button>
              <button
                type="button"
                onClick={() => setView('conference')}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  view === 'conference' ? 'border-button text-button' : 'border-transparent text-ink/60'
                }`}
              >
                Conference info
              </button>
            </div>

            {view === 'conference' ? <ConferenceInfoTab conferenceId={conferenceId} /> : null}

            {view === 'requests' ? (
          <>
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

            <div className="mt-4 flex gap-2 border-b border-line">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
                    tab === t ? 'border-button text-button' : 'border-transparent text-ink/60'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-ink/60">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
                No {tab} requests.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
                {filtered.map((request) => (
                  <li key={request.id} className="px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{request.applicant_name ?? request.applicant_email}</p>
                        <p className="text-sm text-ink/60">
                          {request.applicant_email ?? 'No email'} ·{' '}
                          {request.applicant_phone ?? 'No phone'}
                        </p>
                        <p className="mt-1 text-sm text-ink/70">
                          {getRoleDefinition(request.role_code)?.label ?? request.role_code} ·{' '}
                          {new Date(request.created_at).toLocaleDateString()}
                        </p>
                        {request.status === 'rejected' && request.reject_reason ? (
                          <p className="mt-1 text-sm text-red-600">Reason: {request.reject_reason}</p>
                        ) : null}
                      </div>
                      {request.status === 'pending' ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprove(request.id)}
                            disabled={busyId === request.id}
                            className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => startReject(request.id)}
                            disabled={busyId === request.id}
                            className="rounded-md border border-line px-3 py-1 text-sm font-medium hover:bg-background disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {rejectingId === request.id ? (
                      <div className="mt-3 rounded-md border border-line bg-background p-3">
                        <label htmlFor={`reason-${request.id}`} className="block text-sm font-medium">
                          Reason for rejecting
                        </label>
                        <textarea
                          id={`reason-${request.id}`}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={2}
                          className="mt-1 block w-full rounded-md border border-line px-3 py-2"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => confirmReject(request.id)}
                            disabled={busyId === request.id}
                            className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Confirm reject
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectingId(null)}
                            className="rounded-md border border-line px-3 py-1 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
