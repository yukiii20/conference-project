import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { getRoleDefinition } from '../lib/roles'
import { PortalHeader } from '../components/PortalHeader'
import { PageHeader } from '../components/ui/PageHeader'
import { Select } from '../components/ui/Input'
import { PortalSidebar } from './portal/PortalSidebar'
import { DashboardTab } from './portal/DashboardTab'
import { MyCertificatesTab } from './portal/MyCertificatesTab'
import { MyTicketTab } from './portal/MyTicketTab'
import { NotificationsTab } from './portal/NotificationsTab'
import { AuthorSection } from './portal/sections/AuthorSection'
import { ReviewerSection } from './portal/sections/ReviewerSection'
import { SessionChairSection } from './portal/sections/SessionChairSection'
import { StaffSection } from './portal/sections/StaffSection'
import { DirtyGuardProvider, useDirtyGuard } from './convenor/DirtyGuard'
import { visibleSections } from './portal/sidebarConfig'

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

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

  return (
    <div className="flex min-h-screen flex-col bg-background text-ink">
      <PortalHeader roleLabel={myRoleLabels.length > 0 ? myRoleLabels.join(' · ') : (user?.full_name ?? 'Portal')} />

      <div className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6 sm:px-8">
        <PageHeader
          title="My portal"
          actions={
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-expanded={mobileNavOpen}
              aria-controls="portal-sidebar"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted md:hidden"
            >
              {mobileNavOpen ? 'Close menu' : 'Menu'}
            </button>
          }
          className="mb-0"
        />

        {myConferences.length > 1 ? (
          <div className="mt-3">
            <label htmlFor="portal-conference" className="block text-xs font-medium text-text-muted">
              Conference
            </label>
            <Select
              id="portal-conference"
              value={conferenceId ?? ''}
              onChange={(e) => setConferenceId(e.target.value)}
              className="mt-1 max-w-sm"
            >
              {myConferences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ) : conference ? (
          <p className="mt-1 text-text-muted">{conference.name}</p>
        ) : null}

        <div className="mt-6 flex flex-col gap-8 md:flex-row">
          <aside
            id="portal-sidebar"
            className={`shrink-0 self-start rounded-lg border border-border bg-surface p-2 md:sticky md:top-6 md:block md:w-56 ${mobileNavOpen ? 'block' : 'hidden'}`}
          >
            <PortalSidebar base={base} sections={sections} onNavigate={() => setMobileNavOpen(false)} />
          </aside>

          <main className="min-w-0 flex-1" onChangeCapture={markDirty} onInputCapture={markDirty} onSubmitCapture={clearDirty}>
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
              <Route path="ticket" element={<MyTicketTab conferenceId={conferenceId} />} />
              <Route path="certificates" element={<MyCertificatesTab />} />
              <Route path="notifications" element={<NotificationsTab />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}
