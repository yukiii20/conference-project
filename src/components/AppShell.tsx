import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react'
import { PortalHeader } from './PortalHeader'
import { LogoMark } from './landing/LandingHeader'
import { CommandPalette, isTypingTarget, type SearchItem } from './CommandPalette'
import { HelpMenu } from './HelpMenu'
import { Tooltip } from './ui/Tooltip'
import { useMediaQuery } from './ui/Popover'

export type { SearchItem } from './CommandPalette'

/** Account destinations every signed-in workspace can jump to. */
const ACCOUNT_SEARCH_ITEMS: SearchItem[] = [
  { id: 'account-profile', label: 'Profile', group: 'Account', to: '/profile', keywords: ['photo', 'name', 'orcid', 'institution'] },
  { id: 'account-password', label: 'Change password', group: 'Account', to: '/change-password', keywords: ['security'] },
]

export type Crumb = { label: string; to?: string }

const COLLAPSE_KEY = 'cms.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Signed-in application frame shared by the portal, convenor/manager portal
 * and super admin: a navy sidebar (collapsible to icons from md up, an
 * off-canvas drawer below md) and a light top bar with breadcrumbs,
 * notifications and the profile menu.
 *
 * `renderNav` receives `collapsed` so the nav can hide its labels visually
 * (keeping them for screen readers) when the rail is narrow.
 */
export function AppShell({
  sidebarId,
  workspaceLabel,
  roleLabel,
  context,
  renderNav,
  crumbs,
  search = [],
  beforeNavigate,
  children,
}: {
  /** id of the <aside> - the mobile "Menu" button's aria-controls target. */
  sidebarId: string
  /** Small caps label above the conference context, e.g. "Convenor workspace". */
  workspaceLabel: string
  roleLabel: string
  /** Conference name / switcher, shown under the logo while expanded. */
  context?: ReactNode
  renderNav: (opts: { collapsed: boolean; onNavigate: () => void }) => ReactNode
  crumbs: Crumb[]
  /** Destinations for the Ctrl/⌘ K "jump to" search (account pages are added automatically). */
  search?: SearchItem[]
  /** Unsaved-changes guard: return false to stay on the page. */
  beforeNavigate?: () => boolean
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()
  const searchItems = useMemo(() => [...search, ...ACCOUNT_SEARCH_ITEMS], [search])

  // Global shortcuts: Ctrl/⌘ K or "/" opens search, "[" toggles the sidebar rail.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      if (document.querySelector('[aria-modal="true"]')) return
      if (e.key === '/') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (e.key === '[' && window.matchMedia('(min-width: 768px)').matches) {
        setCollapsed((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      // Private mode / blocked storage - collapse just won't be remembered.
    }
  }, [collapsed])

  // Close the drawer on navigation and on Escape.
  useEffect(() => setMobileOpen(false), [location.pathname])
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  const menuButton = (
    <button
      type="button"
      onClick={() => setMobileOpen((v) => !v)}
      aria-expanded={mobileOpen}
      aria-controls={sidebarId}
      className="-ml-1.5 inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-text hover:bg-surface-muted md:hidden"
    >
      {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      <span className="max-sm:sr-only">{mobileOpen ? 'Close menu' : 'Menu'}</span>
    </button>
  )

  return (
    <div className="min-h-screen bg-page-bg text-text md:flex">
      <a
        href="#app-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('app-content')?.focus()
        }}
        className="sr-only z-[100] rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 animate-fade-in bg-brand/40 backdrop-blur-[2px] md:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      ) : null}

      <aside
        id={sidebarId}
        className={`fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col bg-brand text-white shadow-pop transition-[transform,width] duration-200 ease-out md:sticky md:top-0 md:z-auto md:h-screen md:max-w-none md:translate-x-0 md:shadow-none ${
          collapsed ? 'md:w-[4.75rem]' : 'md:w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full max-md:invisible'}`}
      >
        <div className={`flex h-16 shrink-0 items-center gap-2.5 border-b border-white/10 ${collapsed ? 'md:justify-center md:px-0' : ''} px-5`}>
          <Link to="/" className="flex min-w-0 items-center gap-2.5" title="Conference Management System">
            <LogoMark size={32} onDark />
            <span className={`truncate font-display text-[15px] font-semibold tracking-tight ${collapsed ? 'md:hidden' : ''}`}>
              Conference CMS
            </span>
          </Link>
        </div>

        <div className={`shrink-0 px-4 pb-2 pt-5 ${collapsed ? 'md:hidden' : ''}`}>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
            <span className="h-px w-4 bg-gold/70" aria-hidden="true" />
            {workspaceLabel}
          </p>
          {context ? <div className="mt-2.5">{context}</div> : null}
        </div>

        <div className={`sidebar-scroll min-h-0 flex-1 overflow-y-auto pb-4 ${collapsed ? 'md:px-2.5 md:pt-4' : ''} px-3 pt-2`}>
          {renderNav({ collapsed, onNavigate: () => setMobileOpen(false) })}
        </div>

        <div className="hidden shrink-0 border-t border-white/10 p-3 md:block">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            {collapsed ? null : <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <PortalHeader
          roleLabel={roleLabel}
          leading={menuButton}
          tools={
            <>
              <SearchButton onClick={() => setPaletteOpen(true)} />
              <HelpMenu />
            </>
          }
        >
          <Breadcrumbs crumbs={crumbs} />
        </PortalHeader>
        <div id="app-content" tabIndex={-1} className="mx-auto w-full max-w-[1320px] flex-1 animate-fade-in px-4 py-6 focus:outline-none sm:px-6 sm:py-8 lg:px-10">
          {children}
        </div>
      </div>

      <CommandPalette items={searchItems} open={paletteOpen} onOpenChange={setPaletteOpen} beforeNavigate={beforeNavigate} />
    </div>
  )
}

function SearchButton({ onClick }: { onClick: () => void }) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search pages and sections"
      aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      className="flex h-10 items-center gap-2 rounded-lg text-sm text-text-muted transition-colors hover:bg-surface-muted hover:text-text max-xl:w-10 max-xl:justify-center xl:w-56 xl:border xl:border-border-soft xl:bg-page-bg xl:px-3 xl:hover:border-border"
    >
      <Search size={17} aria-hidden="true" className="shrink-0" />
      <span className="flex-1 text-left max-xl:hidden">Search…</span>
      <kbd className="rounded border border-border bg-surface px-1.5 font-sans text-[11px] leading-5 max-xl:hidden">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
    </button>
  )
}

/**
 * One sidebar row as a link, with a hover/focus tooltip on the collapsed
 * rail (the label is also kept for screen readers).
 */
export function SidebarNavItem({
  to,
  icon,
  label,
  badge = 0,
  collapsed,
  onClick,
  end,
}: {
  to: string
  icon: ReactNode
  label: string
  badge?: number
  collapsed: boolean
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  end?: boolean
}) {
  const showTooltips = useMediaQuery('(min-width: 768px)') && collapsed
  return (
    <Tooltip content={badge > 0 ? `${label} (${badge})` : label} placement="right" disabled={!showTooltips} className="block">
      <NavLink to={to} end={end} onClick={onClick} className={({ isActive }) => sidebarLinkClass(isActive, collapsed)}>
        <SidebarLinkContent icon={icon} label={label} badge={badge} collapsed={collapsed} />
      </NavLink>
    </Tooltip>
  )
}

/** Button variant of SidebarNavItem, for workspaces whose sections are in-page state (super admin). */
export function SidebarNavButton({
  icon,
  label,
  badge = 0,
  collapsed,
  active,
  onClick,
  role,
}: {
  icon: ReactNode
  label: string
  badge?: number
  collapsed: boolean
  active: boolean
  onClick: () => void
  role?: 'tab'
}) {
  const showTooltips = useMediaQuery('(min-width: 768px)') && collapsed
  return (
    <Tooltip content={badge > 0 ? `${label} (${badge})` : label} placement="right" disabled={!showTooltips} className="block">
      <button
        type="button"
        role={role}
        aria-selected={role === 'tab' ? active : undefined}
        aria-current={role ? undefined : active ? 'page' : undefined}
        onClick={onClick}
        className={`w-full text-left ${sidebarLinkClass(active, collapsed)}`}
      >
        <SidebarLinkContent icon={icon} label={label} badge={badge} collapsed={collapsed} />
      </button>
    </Tooltip>
  )
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 overflow-hidden">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li
              key={`${c.label}-${i}`}
              // Only the first crumb (the long conference name, also in the sidebar) gives way; the page you're on never truncates first.
              className={`flex items-center gap-1.5 ${last ? 'min-w-0' : i === 0 ? 'min-w-0 max-w-[14rem] max-lg:hidden xl:max-w-[22rem]' : 'shrink-0 max-lg:hidden'}`}
            >
              {i > 0 ? <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-text-muted/60 max-lg:hidden" /> : null}
              {c.to && !last ? (
                <Link to={c.to} className="truncate text-text-muted transition-colors hover:text-text">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-text" aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * One sidebar row - shared by the portal and convenor sidebars so they look identical.
 * Label stays in the accessible name when collapsed (sr-only), with a native tooltip.
 */
export function SidebarLinkContent({
  icon,
  label,
  badge = 0,
  collapsed,
}: {
  icon: ReactNode
  label: string
  badge?: number
  collapsed: boolean
}) {
  return (
    <>
      <span className="relative flex shrink-0 items-center justify-center">
        {icon}
        {collapsed && badge > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 hidden h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-brand md:block" aria-hidden="true" />
        ) : null}
      </span>
      <span className={`flex-1 truncate ${collapsed ? 'md:sr-only' : ''}`}>{label}</span>
      {badge > 0 ? (
        <span
          className={`rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand ${collapsed ? 'md:sr-only' : ''}`}
        >
          {badge}
        </span>
      ) : null}
    </>
  )
}

/** NavLink className for a sidebar row (active = lifted white tint + gold rail). */
export function sidebarLinkClass(isActive: boolean, collapsed: boolean): string {
  return `group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
    collapsed ? 'md:justify-center md:px-0' : ''
  } ${
    isActive
      ? 'bg-white/10 font-medium text-white before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-gold md:before:-left-2.5'
      : 'text-white/65 hover:bg-white/5 hover:text-white'
  }`
}

/** Conference context block for the sidebar: a switcher when there's more than one, otherwise just the name. */
export function ShellConferenceContext({
  id,
  conferences,
  value,
  onChange,
}: {
  id: string
  conferences: Array<{ id: string; name: string }>
  value: string | null
  onChange: (id: string) => void
}) {
  const current = conferences.find((c) => c.id === value)
  if (conferences.length > 1) {
    return (
      <div>
        <label htmlFor={id} className="sr-only">
          Conference
        </label>
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-h-10 cursor-pointer appearance-none rounded-lg border border-white/15 bg-white/5 bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat py-2 pl-3 pr-8 text-sm font-medium text-white transition-colors hover:border-white/25 focus:border-gold focus:outline-none [&>option]:text-text"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23d9b982' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5M7 9l5-5 5 5'/%3E%3C/svg%3E\")",
          }}
        >
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (!current) return null
  return (
    <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium leading-snug text-white" title={current.name}>
      <span className="line-clamp-2">{current.name}</span>
    </p>
  )
}

/** Section heading inside the sidebar nav (hidden on the collapsed rail). */
export function SidebarGroupLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  return (
    <p
      className={`px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35 first:pt-0 ${
        collapsed ? 'md:hidden' : ''
      }`}
    >
      {children}
    </p>
  )
}
