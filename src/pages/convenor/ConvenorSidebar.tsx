import { NavLink, useLocation } from 'react-router-dom'
import { useDirtyGuard } from './DirtyGuard'
import { SECTIONS, visibleTabs } from './sidebarConfig'

function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={path} />
    </svg>
  )
}

const ICON_PATHS: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zM13 21h8V11h-8v10zM13 3v6h8V3h-8zM3 21h8v-6H3v6z',
  setup: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  'schedule-basics': 'M8 2v4M16 2v4M3.5 9h17M4.5 5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  people: 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22.5 21v-2a4 4 0 0 0-3-3.87M16.5 3.13a4 4 0 0 1 0 7.75',
  papers: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6M9 9h1',
  event: 'M4 4h16v16H4zM4 9h16M9 4v5M8 14h2v2H8zM14 14h2v2h-2z',
  communication: 'M4 4h16v16H4zM4 6l8 7 8-7',
}

export function ConvenorSidebar({
  base,
  isManager,
  pendingRoleRequests,
  papersAttention,
  onNavigate,
}: {
  base: string
  isManager: boolean
  pendingRoleRequests: number
  papersAttention: number
  onNavigate?: () => void
}) {
  // Managers can't act on role requests (members.manage only) - don't show a
  // badge count for something that would 403 if they clicked through to it.
  const badges: Record<string, number> = {
    people: isManager ? 0 : pendingRoleRequests,
    papers: papersAttention,
  }

  const items = SECTIONS.filter((s) => s.tabs.length === 0 || visibleTabs(s, isManager).length > 0)
  const location = useLocation()
  const { confirmLeave } = useDirtyGuard()

  return (
    <nav className="space-y-0.5">
      {items.map((s) => {
        const badge = badges[s.id] ?? 0
        const isCurrentPage = location.pathname.startsWith(`${base}/${s.id}`)
        return (
          <NavLink
            key={s.id}
            to={`${base}/${s.id}`}
            onClick={(e) => {
              if (!isCurrentPage && !confirmLeave()) {
                e.preventDefault()
                return
              }
              onNavigate?.()
            }}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md border-l-[3px] px-3 py-2 text-sm ${
                isActive
                  ? 'border-brand bg-surface font-medium text-brand'
                  : 'border-transparent text-text/70 hover:bg-border-soft'
              }`
            }
          >
            <Icon path={ICON_PATHS[s.id]!} />
            <span className="flex-1">{s.label}</span>
            {badge > 0 ? (
              <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-white">{badge}</span>
            ) : null}
          </NavLink>
        )
      })}
    </nav>
  )
}
