import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { api, setAdminViewAs } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { AdminViewAsProvider } from '../lib/adminViewAsContext'
import { AppShell, ShellConferenceContext, type Crumb } from '../components/AppShell'
import { PageHeader } from '../components/ui/PageHeader'
import { Alert } from '../components/ui/Alert'
import { Spinner } from '../components/ui/Spinner'
import { ConvenorSidebar } from './convenor/ConvenorSidebar'
import { DashboardTab } from './convenor/DashboardTab'
import { SetupSection } from './convenor/sections/SetupSection'
import { ScheduleBasicsSection } from './convenor/sections/ScheduleBasicsSection'
import { PeopleSection } from './convenor/sections/PeopleSection'
import { PapersSection } from './convenor/sections/PapersSection'
import { EventSection } from './convenor/sections/EventSection'
import { CommunicationSection } from './convenor/sections/CommunicationSection'
import { DirtyGuardProvider, useDirtyGuard } from './convenor/DirtyGuard'
import { OLD_PATH_REDIRECTS, SECTIONS } from './convenor/sidebarConfig'

type ConvenorConference = { id: string; name: string; slug: string; roleCode: string }

type DashboardSummary = {
  needs_attention: {
    pending_role_requests: number
    submitted_no_reviewer: number
    overdue_reviews: number
    awaiting_decision: number
  }
}

type ViewAsInfo = { conferenceId: string; conferenceName: string }

export function ConvenorPage({ viewAs }: { viewAs?: ViewAsInfo } = {}) {
  return (
    <DirtyGuardProvider>
      <ConvenorPageInner viewAs={viewAs} />
    </DirtyGuardProvider>
  )
}

function ConvenorPageInner({ viewAs }: { viewAs?: ViewAsInfo }) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null
  const { roles } = useAuth()
  const { markDirty, clearDirty } = useDirtyGuard()
  const isManagerPortal = !viewAs && location.pathname.startsWith('/manager')
  const base = viewAs ? `/super-admin/view-as/${viewAs.conferenceId}` : isManagerPortal ? '/manager' : '/convenor'

  const [myConferences, setMyConferences] = useState<ConvenorConference[]>([])
  const [conferenceId, setConferenceId] = useState<string | null>(viewAs?.conferenceId ?? null)
  const [loading, setLoading] = useState(!viewAs)
  const [missingAbstractDates, setMissingAbstractDates] = useState(false)
  const [pendingRoleRequests, setPendingRoleRequests] = useState(0)
  const [papersAttention, setPapersAttention] = useState(0)

  useEffect(() => {
    if (viewAs) return
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
  }, [roles, preselectedSlug, isManagerPortal, viewAs])

  // Every request the api client makes while this is mounted carries a header
  // the server rejects on any write — on top of (not instead of) each save
  // button being disabled below, so a stray request can't sneak a change through.
  useEffect(() => {
    if (!viewAs) return
    setAdminViewAs(true)
    return () => setAdminViewAs(false)
  }, [viewAs])

  const conferenceName = viewAs ? viewAs.conferenceName : myConferences.find((c) => c.id === conferenceId)?.name ?? ''

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

  const workspaceLabel = viewAs ? 'Admin view' : isManagerPortal ? 'Manager workspace' : 'Convenor workspace'
  const activeSectionId = location.pathname.slice(base.length + 1).split('/')[0]
  const activeSection = SECTIONS.find((s) => s.id === activeSectionId)
  const activeTabId = location.pathname.slice(base.length + 1).split('/')[1]
  const activeTab = activeSection?.tabs.find((t) => t.id === activeTabId)
  const crumbs: Crumb[] = [
    { label: conferenceName || (isManagerPortal ? 'Manager' : 'Convenor'), to: `${base}/dashboard` },
    ...(activeSection ? [{ label: activeSection.label }] : []),
    ...(activeTab ? [{ label: activeTab.label }] : []),
  ]
  const conferenceContext = viewAs ? (
    <ShellConferenceContext id="convenor-conference" conferences={[{ id: viewAs.conferenceId, name: viewAs.conferenceName }]} value={viewAs.conferenceId} onChange={() => {}} />
  ) : (
    <ShellConferenceContext id="convenor-conference" conferences={myConferences} value={conferenceId} onChange={setConferenceId} />
  )

  if (loading || !conferenceId) {
    return (
      <AppShell
        sidebarId="convenor-sidebar"
        workspaceLabel={workspaceLabel}
        roleLabel={isManagerPortal ? 'Manager' : 'Convenor'}
        renderNav={() => null}
        crumbs={[{ label: isManagerPortal ? 'Manager' : 'Convenor' }]}
      >
        <PageHeader title={isManagerPortal ? 'Manager' : 'Convenor'} />
        {loading ? (
          <div className="mt-6 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
            You are not set up as {isManagerPortal ? 'a manager' : 'convenor'} of any conference yet.
          </p>
        )}
      </AppShell>
    )
  }

  return (
    <AppShell
      sidebarId="convenor-sidebar"
      workspaceLabel={workspaceLabel}
      roleLabel={viewAs ? 'Administrator' : isManagerPortal ? 'Manager' : 'Convenor'}
      context={conferenceContext}
      renderNav={({ collapsed, onNavigate }) => (
        <ConvenorSidebar
          base={base}
          isManager={isManagerPortal}
          pendingRoleRequests={pendingRoleRequests}
          papersAttention={papersAttention}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      )}
      crumbs={crumbs}
    >
        {viewAs ? (
          <div role="status" className="mb-6">
            <Alert variant="warning">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Viewing <strong>{viewAs.conferenceName}</strong> as admin — read-only.
                </span>
                <Link to="/super-admin" className="font-medium underline">
                  Exit
                </Link>
              </div>
            </Alert>
          </div>
        ) : null}

        {missingAbstractDates ? (
          <div className="mb-6">
            <Alert variant="warning">Authors cannot submit until you set the Abstract submission dates in Key dates.</Alert>
          </div>
        ) : null}

          <main className="min-w-0" onChangeCapture={markDirty} onInputCapture={markDirty} onSubmitCapture={clearDirty}>
            {/* In "view as admin" mode this disables every input/select/textarea/button inside —
                the real enforcement is server-side (blockWritesInAdminViewAsMode), this just keeps
                the admin from clicking a save button that would only fail anyway. */}
            <fieldset disabled={Boolean(viewAs)} className="m-0 min-w-0 border-0 p-0">
              <AdminViewAsProvider value={Boolean(viewAs)}>
              <Routes>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DashboardTab conferenceId={conferenceId} base={base} isManager={isManagerPortal} />} />
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
              </AdminViewAsProvider>
            </fieldset>
          </main>
    </AppShell>
  )
}
