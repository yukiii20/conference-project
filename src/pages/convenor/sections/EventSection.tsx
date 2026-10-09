import { ProgrammeTab } from '../ProgrammeTab'
import { ComingSoonTab } from '../ComingSoonTab'
import { SECTIONS } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

export function EventSection({ conferenceId, basePath }: { conferenceId: string; basePath: string }) {
  const section = SECTIONS.find((s) => s.id === 'event')!
  return (
    <TabbedSection
      basePath={basePath}
      tabs={section.tabs.map((t) => ({
        ...t,
        element: t.id === 'programme' ? <ProgrammeTab conferenceId={conferenceId} /> : <ComingSoonTab label={t.label} />,
      }))}
    />
  )
}
