import { AnnouncementsTab } from '../AnnouncementsTab'
import { BulkEmailTab } from '../BulkEmailTab'
import { EmailTemplatesTab } from '../EmailTemplatesTab'
import { EmailLogTab } from '../../../components/EmailLogTab'
import { ReportsTab } from '../ReportsTab'
import { ActivityLogTab } from '../ActivityLogTab'
import { SECTIONS, visibleTabs } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

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
          ) : (
            <ActivityLogTab conferenceId={conferenceId} />
          ),
      }))}
    />
  )
}
