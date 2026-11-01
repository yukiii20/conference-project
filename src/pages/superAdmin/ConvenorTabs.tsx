import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { inviteConvenorSchema } from '../../lib/validation'
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  Icon,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../../components/ui'
import { type ConferenceRow, type ConvenorInfo, type ProfileRow } from './shared'

export const EMPTY_INVITE_CONVENOR = {
  conference_id: '',
  full_name: '',
  email: '',
  phone: '',
}

export type InviteConvenorResult = { invited: boolean; appointed: boolean }

export function CreateConvenorTab({
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
    <div className="mt-6">
      <PageHeader
        title="Create convenor"
        subtitle="Invites a brand-new person by email to run a conference — they set their own password from the link."
      />
      <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
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

      <Button type="submit" loading={submitting} iconLeft={<Icon icon={Send} size={16} />}>
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
    </div>
  )
}

export function AppointConvenorTab({
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
    <div className="mt-6">
      <PageHeader
        title="Appoint existing account"
        subtitle="Makes someone who already has an account the convenor of a conference — no invitation email, no new password."
      />
      <div className="max-w-2xl space-y-4">
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
    </div>
  )
}
