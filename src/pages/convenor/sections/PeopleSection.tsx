import { RoleRequestsTab } from '../RoleRequestsTab'
import { MembersTab } from '../MembersTab'
import { CommitteesTab } from '../CommitteesTab'
import { SpeakersTab } from '../SpeakersTab'
import { SECTIONS, visibleTabs } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

export function PeopleSection({
  conferenceId,
  basePath,
  isManager,
}: {
  conferenceId: string
  basePath: string
  isManager: boolean
}) {
  const section = SECTIONS.find((s) => s.id === 'people')!
  return (
    <TabbedSection
      basePath={basePath}
      tabs={visibleTabs(section, isManager).map((t) => ({
        ...t,
        element:
          t.id === 'requests' ? (
            <RoleRequestsTab conferenceId={conferenceId} />
          ) : t.id === 'members' ? (
            <MembersTab conferenceId={conferenceId} />
          ) : t.id === 'committees' ? (
            <CommitteesTab conferenceId={conferenceId} />
          ) : (
            <SpeakersTab conferenceId={conferenceId} />
          ),
      }))}
    />
  )
}
