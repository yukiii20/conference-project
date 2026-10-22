import { NavLink } from 'react-router-dom'
import { useDirtyGuard } from '../convenor/DirtyGuard'
import type { PortalSectionConfig } from './sidebarConfig'

function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={path} />
    </svg>
  )
}

const ICON_PATHS: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zM13 21h8V11h-8v10zM13 3v6h8V3h-8zM3 21h8v-6H3v6z',
  author: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6M9 9h1',
  reviewer: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  'session-chair': 'M4 4h16v16H4zM4 9h16M9 4v5M8 14h2v2H8zM14 14h2v2h-2z',
  staff: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 0 1.946-.806 3.42 3.42 0 0 1 4.438 0 3.42 3.42 0 0 0 1.946.806 3.42 3.42 0 0 1 3.138 3.138 3.42 3.42 0 0 0 .806 1.946 3.42 3.42 0 0 1 0 4.438 3.42 3.42 0 0 0-.806 1.946 3.42 3.42 0 0 1-3.138 3.138 3.42 3.42 0 0 0-1.946.806 3.42 3.42 0 0 1-4.438 0 3.42 3.42 0 0 0-1.946-.806 3.42 3.42 0 0 1-3.138-3.138 3.42 3.42 0 0 0-.806-1.946 3.42 3.42 0 0 1 0-4.438 3.42 3.42 0 0 0 .806-1.946 3.42 3.42 0 0 1 3.138-3.138z',
  ticket: 'M3 10V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z',
  certificates: 'M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8.5 13.5L7 21l5-2 5 2-1.5-7.5',
  notifications: 'M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 16zM9.5 20.5a2.5 2.5 0 0 0 5 0',
}

export function PortalSidebar({
  base,
  sections,
  badges = {},
  onNavigate,
}: {
  base: string
  sections: PortalSectionConfig[]
  badges?: Record<string, number>
  onNavigate?: () => void
}) {
  const { confirmLeave } = useDirtyGuard()

  return (
    <nav className="space-y-0.5">
      {sections.map((s) => {
        const badge = badges[s.id] ?? 0
        return (
          <NavLink
            key={s.id}
            to={`${base}/${s.id}`}
            onClick={(e) => {
              if (!confirmLeave()) {
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
