import { Fragment } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Award,
  Bell,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  MessageSquareHeart,
  QrCode,
  Ticket,
  type LucideIcon,
} from 'lucide-react'
import { Icon } from '../../components/ui/Icon'
import { SidebarGroupLabel, SidebarNavItem } from '../../components/AppShell'
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
  feedback: MessageSquareHeart,
  notifications: Bell,
}

/** Visual grouping only; sections not listed here (e.g. new personal ones) fall under "Personal". */
const SECTION_GROUP: Record<string, string> = {
  dashboard: 'Overview',
  agenda: 'Overview',
  author: 'My roles',
  reviewer: 'My roles',
  'session-chair': 'My roles',
  staff: 'My roles',
}

export function PortalSidebar({
  base,
  sections,
  badges = {},
  onNavigate,
  collapsed = false,
}: {
  base: string
  sections: PortalSectionConfig[]
  badges?: Record<string, number>
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const { confirmLeave } = useDirtyGuard()

  let lastGroup: string | null = null
  return (
    <nav className="space-y-0.5" aria-label="Portal">
      {sections.map((s) => {
        const badge = badges[s.id] ?? 0
        const group = SECTION_GROUP[s.id] ?? 'Personal'
        const showGroup = group !== lastGroup
        lastGroup = group
        return (
          <Fragment key={s.id}>
            {showGroup ? <SidebarGroupLabel collapsed={collapsed}>{group}</SidebarGroupLabel> : null}
            <SidebarNavItem
              to={`${base}/${s.id}`}
              icon={<Icon icon={SECTION_ICONS[s.id] ?? LayoutDashboard} size={18} />}
              label={s.label}
              badge={badge}
              collapsed={collapsed}
              onClick={(e) => {
                if (!confirmLeave()) {
                  e.preventDefault()
                  return
                }
                onNavigate?.()
              }}
            />
          </Fragment>
        )
      })}
    </nav>
  )
}
