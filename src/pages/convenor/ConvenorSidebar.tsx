import { Fragment } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { CalendarRange, FileText, LayoutDashboard, MessageSquare, PartyPopper, Settings, Users, type LucideIcon } from 'lucide-react'
import { Icon } from '../../components/ui/Icon'
import { SidebarGroupLabel, SidebarLinkContent, sidebarLinkClass } from '../../components/AppShell'
import { useDirtyGuard } from './DirtyGuard'
import { SECTIONS, visibleTabs } from './sidebarConfig'

const SECTION_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  setup: Settings,
  'schedule-basics': CalendarRange,
  people: Users,
  papers: FileText,
  event: PartyPopper,
  communication: MessageSquare,
}

/** Group headings shown above these sections (visual grouping only - order still comes from sidebarConfig). */
const GROUP_BEFORE: Record<string, string> = {
  setup: 'Set up',
  papers: 'Run the conference',
  communication: 'Communicate',
}

export function ConvenorSidebar({
  base,
  isManager,
  pendingRoleRequests,
  papersAttention,
  onNavigate,
  collapsed = false,
}: {
  base: string
  isManager: boolean
  pendingRoleRequests: number
  papersAttention: number
  onNavigate?: () => void
  collapsed?: boolean
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
    <nav className="space-y-0.5" aria-label="Convenor">
      {items.map((s) => {
        const badge = badges[s.id] ?? 0
        const isCurrentPage = location.pathname.startsWith(`${base}/${s.id}`)
        const group = GROUP_BEFORE[s.id]
        return (
          <Fragment key={s.id}>
            {group ? <SidebarGroupLabel collapsed={collapsed}>{group}</SidebarGroupLabel> : null}
            <NavLink
              to={`${base}/${s.id}`}
              title={collapsed ? s.label : undefined}
              onClick={(e) => {
                if (!isCurrentPage && !confirmLeave()) {
                  e.preventDefault()
                  return
                }
                onNavigate?.()
              }}
              className={({ isActive }) => sidebarLinkClass(isActive, collapsed)}
            >
              <SidebarLinkContent icon={<Icon icon={SECTION_ICONS[s.id]!} size={18} />} label={s.label} badge={badge} collapsed={collapsed} />
            </NavLink>
          </Fragment>
        )
      })}
    </nav>
  )
}
