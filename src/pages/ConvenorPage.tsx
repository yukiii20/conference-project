import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { MyRoleRow } from '../lib/types'
import { PortalHeader } from '../components/PortalHeader'
import { RoleRequestsTab } from './convenor/RoleRequestsTab'
import { ConferenceDetailsTab } from './convenor/ConferenceDetailsTab'
import { LogoTab } from './convenor/LogoTab'
import { LocationTab } from './convenor/LocationTab'
import { KeyDatesTab } from './convenor/KeyDatesTab'
import { TracksTab } from './convenor/TracksTab'
import { SupportersTab } from './convenor/SupportersTab'
import { ProgrammeTab } from './convenor/ProgrammeTab'
import { SubmissionsTab } from './convenor/SubmissionsTab'

type PageView =
  | 'requests'
  | 'details'
  | 'logo'
  | 'location'
  | 'dates'
  | 'tracks'
  | 'supporters'
  | 'programme'
  | 'submissions'

const VIEWS: { id: PageView; label: string }[] = [
  { id: 'requests', label: 'Role requests' },
  { id: 'details', label: 'Conference details' },
  { id: 'logo', label: 'Logo' },
  { id: 'location', label: 'Location' },
  { id: 'dates', label: 'Key dates' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'supporters', label: 'Supporters' },
  { id: 'programme', label: 'Programme' },
  { id: 'submissions', label: 'Submissions' },
]

type ConvenorConference = { id: string; name: string; slug: string }

export function ConvenorPage() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null

  const [myConferences, setMyConferences] = useState<ConvenorConference[]>([])
  const [conferenceId, setConferenceId] = useState<string | null>(null)
  const [view, setView] = useState<PageView>('requests')
  const [loading, setLoading] = useState(true)
  const [missingAbstractDates, setMissingAbstractDates] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return

      const { data: rolesData } = await supabase.rpc('get_my_roles')

      if (cancelled) return

      const roles = (rolesData ?? []) as MyRoleRow[]
      const confIds = roles.filter((r) => r.role_code === 'convenor' && r.conference_id).map((r) => r.conference_id as string)

      if (confIds.length === 0) {
        setLoading(false)
        return
      }

      const { data: confData } = await supabase.from('conferences').select('id, name, slug').in('id', confIds)
      if (cancelled) return

      const options = (confData ?? []) as ConvenorConference[]
      setMyConferences(options)

      const preselected = preselectedSlug ? options.find((c) => c.slug === preselectedSlug) : null
      setConferenceId((preselected ?? options[0])?.id ?? null)
      setLoading(false)
    }

    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const conferenceName = myConferences.find((c) => c.id === conferenceId)?.name ?? ''

  useEffect(() => {
    if (!conferenceId) return
    let cancelled = false

    async function checkAbstractDates() {
      const { data } = await supabase
        .from('conference_deadlines')
        .select('id')
        .eq('conference_id', conferenceId as string)
        .eq('deadline_type', 'abstract_submission')
        .maybeSingle()
      if (cancelled) return
      setMissingAbstractDates(!data)
    }

    checkAbstractDates()
    return () => {
      cancelled = true
    }
  }, [conferenceId, view])

  return (
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel="Convenor" />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Convenor</h1>

        {myConferences.length > 1 ? (
          <div className="mt-3">
            <label htmlFor="convenor-conference" className="block text-xs font-medium text-ink/60">
              Conference
            </label>
            <select
              id="convenor-conference"
              value={conferenceId ?? ''}
              onChange={(e) => setConferenceId(e.target.value)}
              className="mt-1 w-full max-w-sm rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
            >
              {myConferences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : conferenceName ? (
          <p className="mt-1 text-ink/70">{conferenceName}</p>
        ) : null}

        {conferenceId && missingAbstractDates ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800"
          >
            Authors cannot submit until you set the Abstract submission dates in Key dates.
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-ink/60">Loading…</p>
        ) : !conferenceId ? (
          <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
            You are not set up as convenor of any conference yet.
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2 border-b border-line">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                    view === v.id ? 'border-button text-button' : 'border-transparent text-ink/60'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {view === 'requests' ? <RoleRequestsTab conferenceId={conferenceId} /> : null}
            {view === 'details' ? <ConferenceDetailsTab conferenceId={conferenceId} /> : null}
            {view === 'logo' ? <LogoTab conferenceId={conferenceId} /> : null}
            {view === 'location' ? <LocationTab conferenceId={conferenceId} /> : null}
            {view === 'dates' ? <KeyDatesTab conferenceId={conferenceId} /> : null}
            {view === 'tracks' ? <TracksTab conferenceId={conferenceId} /> : null}
            {view === 'supporters' ? <SupportersTab conferenceId={conferenceId} /> : null}
            {view === 'programme' ? <ProgrammeTab conferenceId={conferenceId} /> : null}
            {view === 'submissions' ? <SubmissionsTab conferenceId={conferenceId} /> : null}
          </>
        )}
      </main>
    </div>
  )
}
