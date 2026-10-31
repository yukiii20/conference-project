import { NavLink } from 'react-router-dom'
import {
  Award,
  Bell,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  QrCode,
  Ticket,
  type LucideIcon,
} from 'lucide-react'
import { Icon } from '../../components/ui/Icon'
import { useDirtyGuard } from '../convenor/DirtyGuard'
import type { PortalSectionConfig } from './sidebarConfig'

const SECTION_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  agenda: CalendarCheck,
  author: FileText,
  reviewer: ClipboardCheck,
  'session-chair': CalendarDays,
  staff: QrCode,
  ticket: Ticket,
  certificates: Award,
  notifications: Bell,
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
            <Icon icon={SECTION_ICONS[s.id]!} className="shrink-0" />
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
