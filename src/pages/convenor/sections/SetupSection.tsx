import { ConferenceDetailsTab } from '../ConferenceDetailsTab'
import { LogoTab } from '../LogoTab'
import { LocationTab } from '../LocationTab'
import { SupportersTab } from '../SupportersTab'
import { SECTIONS } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

export function SetupSection({ conferenceId, basePath }: { conferenceId: string; basePath: string }) {
  const section = SECTIONS.find((s) => s.id === 'setup')!
  return (
    <TabbedSection
      basePath={basePath}
      tabs={section.tabs.map((t) => ({
        ...t,
        element:
          t.id === 'details' ? (
            <ConferenceDetailsTab conferenceId={conferenceId} />
          ) : t.id === 'branding' ? (
            <LogoTab conferenceId={conferenceId} />
          ) : t.id === 'location' ? (
            <LocationTab conferenceId={conferenceId} />
          ) : (
            <SupportersTab conferenceId={conferenceId} />
          ),
      }))}
    />
  )
}
