import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  BarChart3,
  Building2,
  LayoutDashboard,
  Lightbulb,
  Mail,
  Settings,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useNoIndex } from '../lib/noindex'
import { EmailLogTab } from '../components/EmailLogTab'
import { SuggestionsAdminTab } from '../components/SuggestionsAdminTab'
import { AppShell, SidebarGroupLabel, SidebarNavButton, type SearchItem } from '../components/AppShell'
import { Icon, PageHeader, Spinner, Tabs } from '../components/ui'
import { type AdminConferenceRow, type AdminTab, type ConferenceRow, type ConvenorInfo } from './superAdmin/shared'
import { ConferencesTab } from './superAdmin/ConferencesTab'
import { AppointConvenorTab, CreateConvenorTab } from './superAdmin/ConvenorTabs'
import { UsersTab } from './superAdmin/UsersTab'
import { DashboardTab } from './superAdmin/DashboardTab'
import { AdminsTab } from './superAdmin/AdminsTab'
import { PlatformSettingsTab } from './superAdmin/PlatformSettingsTab'

// Lazy so recharts is its own chunk, never part of the main bundle.
const PlatformAnalyticsTab = lazy(() => import('../components/PlatformAnalyticsTab'))

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'conferences', label: 'Conferences' },
  { id: 'create-convenor', label: 'Create convenor' },
  { id: 'appoint-convenor', label: 'Appoint existing account' },
  { id: 'users', label: 'Users' },
  { id: 'admins', label: 'Admins' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'settings', label: 'Platform settings' },
  { id: 'email-log', label: 'Email log' },
  { id: 'analytics', label: 'Analytics' },
]

export function SuperAdminPage() {
  useNoIndex()
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const [conferences, setConferences] = useState<ConferenceRow[]>([])
  const [convenorByConference, setConvenorByConference] = useState<Record<string, ConvenorInfo>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newSuggestionsCount, setNewSuggestionsCount] = useState(0)

  const loadNewSuggestionsCount = useCallback(async () => {
    try {
      const data = await api.get<{ counts_by_status: Array<{ status: string; count: number }> }>('/admin/suggestions', {
        page: '1',
      })
      setNewSuggestionsCount(data.counts_by_status.find((c) => c.status === 'new')?.count ?? 0)
    } catch {
      // Non-critical badge/dashboard count — stay quiet on failure.
    }
  }, [])

  useEffect(() => {
    loadNewSuggestionsCount()
  }, [loadNewSuggestionsCount])

  const loadConferences = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ conferences: AdminConferenceRow[] }>('/admin/conferences')
      setConferences(data.conferences)

      const map: Record<string, ConvenorInfo> = {}
      for (const row of data.conferences) {
        if (row.convenor_id) map[row.id] = { full_name: row.convenor_name, email: row.convenor_email }
      }
      setConvenorByConference(map)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load conferences.')
      setConferences([])
      setConvenorByConference({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConferences()
  }, [loadConferences])

  const tabsWithCounts = TABS.map((t) => (t.id === 'suggestions' ? { ...t, count: newSuggestionsCount } : t))
  const activeTab = TABS.find((t) => t.id === tab)
  const searchItems = useMemo<SearchItem[]>(
    () => TABS.map((t) => ({ id: `admin-${t.id}`, label: t.label, group: 'Administration', keywords: ADMIN_SEARCH_KEYWORDS[t.id], onSelect: () => setTab(t.id) })),
    [],
  )

  return (
    <AppShell
      sidebarId="admin-sidebar"
      workspaceLabel="Platform administration"
      roleLabel="Administrator"
      renderNav={({ collapsed, onNavigate }) => (
        <div role="tablist" aria-orientation="vertical" aria-label="Administration" className="space-y-0.5">
          {tabsWithCounts.map((t) => {
            const isActive = t.id === tab
            const group = ADMIN_GROUP_BEFORE[t.id]
            return (
              <Fragment key={t.id}>
                {group ? <SidebarGroupLabel collapsed={collapsed}>{group}</SidebarGroupLabel> : null}
                <SidebarNavButton
                  role="tab"
                  active={isActive}
                  icon={<AdminTabIcon id={t.id} />}
                  label={t.label}
                  badge={'count' in t ? (t.count ?? 0) : 0}
                  collapsed={collapsed}
                  onClick={() => {
                    setTab(t.id)
                    onNavigate()
                  }}
                />
              </Fragment>
            )
          })}
        </div>
      )}
      crumbs={[{ label: 'Administration', to: undefined }, { label: activeTab?.label ?? 'Dashboard' }]}
      search={searchItems}
    >
      <main>
        <PageHeader title="Administrator" subtitle="Manage conferences, convenors, user accounts, and platform-wide settings." />

        {/* Phones: the sidebar is an off-canvas drawer, so the sections are also an inline tab row here. */}
        <div className="md:hidden">
          <Tabs tabs={tabsWithCounts} active={tab} onChange={(id) => setTab(id as AdminTab)} className="mb-6" />
        </div>

        {tab === 'dashboard' ? (
          <DashboardTab newSuggestionsCount={newSuggestionsCount} onViewSuggestions={() => setTab('suggestions')} />
        ) : null}

        {tab === 'conferences' ? (
          <ConferencesTab
            conferences={conferences}
            convenorByConference={convenorByConference}
            loading={loading}
            loadError={loadError}
            onReload={loadConferences}
          />
        ) : null}

        {tab === 'create-convenor' ? (
          <CreateConvenorTab conferences={conferences} convenorByConference={convenorByConference} onReload={loadConferences} />
        ) : null}

        {tab === 'appoint-convenor' ? (
          <AppointConvenorTab conferences={conferences} convenorByConference={convenorByConference} onReload={loadConferences} />
        ) : null}

        {tab === 'users' ? <UsersTab /> : null}
        {tab === 'admins' ? <AdminsTab /> : null}
        {tab === 'suggestions' ? <SuggestionsAdminTab onCountsChange={setNewSuggestionsCount} /> : null}
        {tab === 'settings' ? <PlatformSettingsTab /> : null}
        {tab === 'email-log' ? <EmailLogTab scope="admin" /> : null}
        {tab === 'analytics' ? (
          <Suspense
            fallback={
              <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
                <Spinner size="sm" /> Loading…
              </div>
            }
          >
            <PlatformAnalyticsTab />
          </Suspense>
        ) : null}
      </main>
    </AppShell>
  )
}

const ADMIN_SEARCH_KEYWORDS: Partial<Record<AdminTab, string[]>> = {
  dashboard: ['system health', 'overview', 'statistics'],
  conferences: ['archive', 'restore', 'view as'],
  'create-convenor': ['new convenor', 'invite'],
  'appoint-convenor': ['assign convenor'],
  users: ['accounts', 'suspend', 'deactivate', 'people'],
  admins: ['platform administrators'],
  settings: ['configuration'],
  'email-log': ['emails', 'failed', 'delivery'],
  analytics: ['charts', 'platform statistics'],
}

const ADMIN_GROUP_BEFORE: Partial<Record<AdminTab, string>> = {
  conferences: 'Conferences',
  users: 'People',
  suggestions: 'Platform',
}

const ADMIN_TAB_ICONS: Record<AdminTab, LucideIcon> = {
  dashboard: LayoutDashboard,
  conferences: Building2,
  'create-convenor': UserPlus,
  'appoint-convenor': UserCheck,
  users: Users,
  admins: ShieldCheck,
  suggestions: Lightbulb,
  settings: Settings,
  'email-log': Mail,
  analytics: BarChart3,
}

function AdminTabIcon({ id }: { id: AdminTab }) {
  return <Icon icon={ADMIN_TAB_ICONS[id]} size={18} />
}
