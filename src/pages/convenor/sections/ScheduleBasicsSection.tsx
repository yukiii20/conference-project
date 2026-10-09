import { KeyDatesTab } from '../KeyDatesTab'
import { TracksTab } from '../TracksTab'
import { SECTIONS } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

export function ScheduleBasicsSection({ conferenceId, basePath }: { conferenceId: string; basePath: string }) {
  const section = SECTIONS.find((s) => s.id === 'schedule-basics')!
  return (
    <TabbedSection
      basePath={basePath}
      tabs={section.tabs.map((t) => ({
        ...t,
        element: t.id === 'dates' ? <KeyDatesTab conferenceId={conferenceId} /> : <TracksTab conferenceId={conferenceId} />,
      }))}
    />
  )
}
