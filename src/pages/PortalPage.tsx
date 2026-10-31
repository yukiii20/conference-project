import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { getRoleDefinition } from '../lib/roles'
import { AppShell, ShellConferenceContext, type Crumb } from '../components/AppShell'
import { PortalSidebar } from './portal/PortalSidebar'
import { DashboardTab } from './portal/DashboardTab'
import { MyAgendaTab } from './portal/MyAgendaTab'
import { GiveFeedbackTab } from './portal/GiveFeedbackTab'
import { MyCertificatesTab } from './portal/MyCertificatesTab'
import { MyTicketTab } from './portal/MyTicketTab'
import { NotificationsTab } from './portal/NotificationsTab'
import { AuthorSection } from './portal/sections/AuthorSection'
import { ReviewerSection } from './portal/sections/ReviewerSection'
import { SessionChairSection } from './portal/sections/SessionChairSection'
import { StaffSection } from './portal/sections/StaffSection'
import { DirtyGuardProvider, useDirtyGuard } from './convenor/DirtyGuard'
import { PORTAL_SECTIONS, visibleSections } from './portal/sidebarConfig'

// Conference-scoped sections only make sense for roles tied to one
// conference at a time — session chairs see "My sessions" across every
// conference they chair regardless of which one is selected here.
const CONFERENCE_SWITCHER_ROLES = ['author', 'reviewer', 'session_chair', 'staff']

type PortalConference = { id: string; name: string; slug: string }

/**
 * Shared portal for every non-convenor/manager/admin role. Unlike the
 * convenor portal (one fixed sidebar), the sections shown here are computed
 * per visitor from the roles they actually hold, in the conference currently
 * selected — a user with several roles sees all of them in one place.
 */
export function PortalPage() {
  return (
    <DirtyGuardProvider>
      <PortalPageInner />
    </DirtyGuardProvider>
  )
}

function PortalPageInner() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null
  const { user, roles } = useAuth()
  const { markDirty, clearDirty } = useDirtyGuard()
  const base = '/portal'
  const location = useLocation()

  const myConferences: PortalConference[] = (() => {
    const seen = new Map<string, PortalConference>()
    for (const r of roles) {
      if (!r.conference_id || !CONFERENCE_SWITCHER_ROLES.includes(r.role_code)) continue
      if (!seen.has(r.conference_id)) {
        seen.set(r.conference_id, { id: r.conference_id, name: r.conference_name ?? '', slug: r.conference_slug ?? '' })
      }
    }
    return [...seen.values()]
  })()

  // Resolved synchronously from the roles already loaded by the time this
  // mounts (ProtectedRoute's guard awaits GET /api/auth/me first) — not left
  // to the effect below alone, which would otherwise leave this null on the
  // very first render and bounce a role-gated route (e.g. a direct visit to
  // /portal/author) straight to the dashboard before the effect ever runs.
  const [conferenceId, setConferenceId] = useState<string | null>(() => {
    const preselected = preselectedSlug ? myConferences.find((c) => c.slug === preselectedSlug) : null
    return (preselected ?? myConferences[0])?.id ?? null
  })

  useEffect(() => {
    const preselected = preselectedSlug ? myConferences.find((c) => c.slug === preselectedSlug) : null
    setConferenceId((prev) => {
      if (prev && myConferences.some((c) => c.id === prev)) return prev
      return (preselected ?? myConferences[0])?.id ?? null
    })
    // Only re-derive when the role list itself or the URL's preselection
    // changes — not on every render, which would stomp a manual switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, preselectedSlug])

  const conference = myConferences.find((c) => c.id === conferenceId) ?? null

  const rolesInConference = new Set(roles.filter((r) => r.conference_id === conferenceId).map((r) => r.role_code))
  const rolesAnywhere = new Set(roles.map((r) => r.role_code))
  const sections = visibleSections(rolesInConference, rolesAnywhere)
  const sectionIds = new Set(sections.map((s) => s.id))

  const myRoleLabels = [...new Set(roles.map((r) => r.role_code))]
    .filter((code) => code !== 'admin' && code !== 'convenor' && code !== 'manager')
    .map((code) => getRoleDefinition(code)?.label ?? code)

  const activeSectionId = location.pathname.slice(base.length + 1).split('/')[0]
  const activeSection = PORTAL_SECTIONS.find((s) => s.id === activeSectionId)
  const crumbs: Crumb[] = [
    { label: 'My portal', to: `${base}/dashboard` },
    ...(activeSection && activeSection.id !== 'dashboard' ? [{ label: activeSection.label }] : [{ label: 'Dashboard' }]),
  ]

  return (
    <AppShell
      sidebarId="portal-sidebar"
      workspaceLabel="My portal"
      roleLabel={myRoleLabels.length > 0 ? myRoleLabels.join(' · ') : (user?.full_name ?? 'Portal')}
      context={<ShellConferenceContext id="portal-conference" conferences={myConferences} value={conferenceId} onChange={setConferenceId} />}
      renderNav={({ collapsed, onNavigate }) => (
        <PortalSidebar base={base} sections={sections} onNavigate={onNavigate} collapsed={collapsed} />
      )}
      crumbs={crumbs}
    >
      <main className="min-w-0" onChangeCapture={markDirty} onInputCapture={markDirty} onSubmitCapture={clearDirty}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route
                path="dashboard"
                element={
                  <DashboardTab
                    conferenceId={conferenceId}
                    conferenceSlug={conference?.slug ?? null}
                    base={base}
                    heldRoles={rolesInConference}
                  />
                }
              />
              <Route
                path="author"
                element={
                  sectionIds.has('author') && conferenceId ? (
                    <AuthorSection conferenceId={conferenceId} />
                  ) : (
                    <Navigate to={`${base}/dashboard`} replace />
                  )
                }
              />
              <Route
                path="reviewer"
                element={
                  sectionIds.has('reviewer') && conferenceId ? (
                    <ReviewerSection conferenceId={conferenceId} />
                  ) : (
                    <Navigate to={`${base}/dashboard`} replace />
                  )
                }
              />
              <Route
                path="session-chair"
                element={sectionIds.has('session-chair') ? <SessionChairSection /> : <Navigate to={`${base}/dashboard`} replace />}
              />
              <Route
                path="staff"
                element={
                  sectionIds.has('staff') && conferenceId ? (
                    <StaffSection conferenceId={conferenceId} />
                  ) : (
                    <Navigate to={`${base}/dashboard`} replace />
                  )
                }
              />
              <Route path="agenda" element={<MyAgendaTab conferenceId={conferenceId} />} />
              <Route path="feedback" element={<GiveFeedbackTab />} />
              <Route path="ticket" element={<MyTicketTab conferenceId={conferenceId} />} />
              <Route path="certificates" element={<MyCertificatesTab />} />
              <Route path="notifications" element={<NotificationsTab />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </main>
    </AppShell>
  )
}
