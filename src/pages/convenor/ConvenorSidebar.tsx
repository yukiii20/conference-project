import { NavLink, useLocation } from 'react-router-dom'
import { CalendarRange, FileText, LayoutDashboard, MessageSquare, PartyPopper, Settings, Users, type LucideIcon } from 'lucide-react'
import { Icon } from '../../components/ui/Icon'
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
