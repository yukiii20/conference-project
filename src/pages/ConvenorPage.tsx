import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { PortalHeader } from '../components/PortalHeader'
import { ConvenorSidebar } from './convenor/ConvenorSidebar'
import { DashboardTab } from './convenor/DashboardTab'
import { SetupSection } from './convenor/sections/SetupSection'
import { ScheduleBasicsSection } from './convenor/sections/ScheduleBasicsSection'
import { PeopleSection } from './convenor/sections/PeopleSection'
import { PapersSection } from './convenor/sections/PapersSection'
import { EventSection } from './convenor/sections/EventSection'
import { CommunicationSection } from './convenor/sections/CommunicationSection'
import { DirtyGuardProvider, useDirtyGuard } from './convenor/DirtyGuard'
import { OLD_PATH_REDIRECTS } from './convenor/sidebarConfig'

type ConvenorConference = { id: string; name: string; slug: string; roleCode: string }

type DashboardSummary = {
  needs_attention: {
    pending_role_requests: number
    submitted_no_reviewer: number
    overdue_reviews: number
    awaiting_decision: number
  }
}

export function ConvenorPage() {
  return (
    <DirtyGuardProvider>
      <ConvenorPageInner />
    </DirtyGuardProvider>
  )
}

function ConvenorPageInner() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null
  const { roles } = useAuth()
  const { markDirty, clearDirty } = useDirtyGuard()
  const isManagerPortal = location.pathname.startsWith('/manager')
  const base = isManagerPortal ? '/manager' : '/convenor'

  const [myConferences, setMyConferences] = useState<ConvenorConference[]>([])
  const [conferenceId, setConferenceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [missingAbstractDates, setMissingAbstractDates] = useState(false)
  const [pendingRoleRequests, setPendingRoleRequests] = useState(0)
  const [papersAttention, setPapersAttention] = useState(0)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    const wantedRole = isManagerPortal ? 'manager' : 'convenor'
    const options: ConvenorConference[] = roles
      .filter((r) => r.role_code === wantedRole && r.conference_id)
      .map((r) => ({
        id: r.conference_id as string,
        name: r.conference_name ?? '',
        slug: r.conference_slug ?? '',
        roleCode: wantedRole,
      }))

    setMyConferences(options)

    const preselected = preselectedSlug ? options.find((c) => c.slug === preselectedSlug) : null
    setConferenceId((preselected ?? options[0])?.id ?? null)
    setLoading(false)
  }, [roles, preselectedSlug, isManagerPortal])

  const conferenceName = myConferences.find((c) => c.id === conferenceId)?.name ?? ''

  useEffect(() => {
    if (!conferenceId) return
    let cancelled = false

    async function checkAbstractDates() {
      try {
        const data = await api.get<{ deadlines: Array<{ code: string; opens_at: string | null }> }>(
          `/conferences/${conferenceId}/deadlines`,
        )
        if (cancelled) return
        const row = data.deadlines.find((d) => d.code === 'abstract_submission')
        setMissingAbstractDates(!row?.opens_at)
      } catch {
        if (cancelled) return
        setMissingAbstractDates(false)
      }
    }

    // Same dashboard summary the Dashboard tab itself shows — reused here just
    // for the two sidebar badge counts (People: pending role requests, Papers:
    // submissions waiting on a reviewer or a decision).
    async function loadBadgeCounts() {
      try {
        const data = await api.get<DashboardSummary>(`/conferences/${conferenceId}/dashboard`)
        if (cancelled) return
        setPendingRoleRequests(data.needs_attention.pending_role_requests)
        setPapersAttention(data.needs_attention.submitted_no_reviewer + data.needs_attention.awaiting_decision)
      } catch {
        if (cancelled) return
        setPendingRoleRequests(0)
        setPapersAttention(0)
      }
    }

    checkAbstractDates()
    loadBadgeCounts()
    return () => {
      cancelled = true
    }
    // Re-run on every navigation so badges/the missing-dates banner stay fresh
    // after an action taken on another tab (e.g. approving a role request).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenceId, location.pathname])

  if (loading || !conferenceId) {
    return (
      <div className="min-h-screen bg-background text-ink">
        <PortalHeader roleLabel={isManagerPortal ? 'Manager' : 'Convenor'} />
        <div className="mx-auto max-w-7xl px-4 py-8">
          <h1 className="text-2xl font-semibold">{isManagerPortal ? 'Manager' : 'Convenor'}</h1>
          {loading ? (
            <p className="mt-6 text-sm text-ink/60">Loading…</p>
          ) : (
            <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
              You are not set up as {isManagerPortal ? 'a manager' : 'convenor'} of any conference yet.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel={isManagerPortal ? 'Manager' : 'Convenor'} />

      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{isManagerPortal ? 'Manager' : 'Convenor'}</h1>
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background md:hidden"
          >
            {mobileNavOpen ? 'Close menu' : 'Menu'}
          </button>
        </div>

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

        {missingAbstractDates ? (
          <div role="alert" className="mt-4 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            Authors cannot submit until you set the Abstract submission dates in Key dates.
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-6 md:flex-row">
          <aside className={`shrink-0 md:block md:w-56 ${mobileNavOpen ? 'block' : 'hidden'}`}>
            <ConvenorSidebar
              base={base}
              isManager={isManagerPortal}
              pendingRoleRequests={pendingRoleRequests}
              papersAttention={papersAttention}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </aside>

          <main className="min-w-0 flex-1" onChangeCapture={markDirty} onInputCapture={markDirty} onSubmitCapture={clearDirty}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardTab conferenceId={conferenceId} base={base} />} />
              <Route path="setup/*" element={<SetupSection conferenceId={conferenceId} basePath={`${base}/setup`} />} />
              <Route
                path="schedule-basics/*"
                element={<ScheduleBasicsSection conferenceId={conferenceId} basePath={`${base}/schedule-basics`} />}
              />
              <Route
                path="people/*"
                element={<PeopleSection conferenceId={conferenceId} basePath={`${base}/people`} isManager={isManagerPortal} />}
              />
              <Route path="papers/*" element={<PapersSection conferenceId={conferenceId} basePath={`${base}/papers`} />} />
              <Route path="event/*" element={<EventSection conferenceId={conferenceId} basePath={`${base}/event`} />} />
              <Route
                path="communication/*"
                element={
                  <CommunicationSection conferenceId={conferenceId} basePath={`${base}/communication`} isManager={isManagerPortal} />
                }
              />

              {/* Old flat tab URLs from before the sidebar was grouped into pages — kept working so nothing breaks. */}
              {Object.entries(OLD_PATH_REDIRECTS).map(([oldPath, newPath]) => (
                <Route key={oldPath} path={oldPath} element={<Navigate to={`${base}/${newPath}`} replace />} />
              ))}

              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}
