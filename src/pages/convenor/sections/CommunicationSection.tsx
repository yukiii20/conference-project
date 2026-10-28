import { lazy, Suspense } from 'react'
import { AnnouncementsTab } from '../AnnouncementsTab'
import { BulkEmailTab } from '../BulkEmailTab'
import { EmailTemplatesTab } from '../EmailTemplatesTab'
import { EmailLogTab } from '../../../components/EmailLogTab'
import { ReportsTab } from '../ReportsTab'
import { ActivityLogTab } from '../ActivityLogTab'
import { Spinner } from '../../../components/ui'
import { SECTIONS, visibleTabs } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

// Lazy so recharts (and everything analytics needs) is its own chunk, never
// part of the main bundle every visitor downloads.
const AnalyticsTab = lazy(() => import('../AnalyticsTab'))

function AnalyticsFallback() {
  return (
    <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
      <Spinner size="sm" /> Loading…
    </div>
  )
}

export function CommunicationSection({
  conferenceId,
  basePath,
  isManager,
}: {
  conferenceId: string
  basePath: string
  isManager: boolean
}) {
  const section = SECTIONS.find((s) => s.id === 'communication')!
  return (
    <TabbedSection
      basePath={basePath}
      tabs={visibleTabs(section, isManager).map((t) => ({
        ...t,
        element:
          t.id === 'announcements' ? (
            <AnnouncementsTab conferenceId={conferenceId} />
          ) : t.id === 'bulk-email' ? (
            <BulkEmailTab conferenceId={conferenceId} />
          ) : t.id === 'templates' ? (
            <EmailTemplatesTab conferenceId={conferenceId} />
          ) : t.id === 'emails' ? (
            <EmailLogTab scope={{ conferenceId }} />
          ) : t.id === 'reports' ? (
            <ReportsTab conferenceId={conferenceId} />
          ) : t.id === 'analytics' ? (
            <Suspense fallback={<AnalyticsFallback />}>
              <AnalyticsTab conferenceId={conferenceId} />
            </Suspense>
          ) : (
            <ActivityLogTab conferenceId={conferenceId} />
          ),
      }))}
    />
  )
}
