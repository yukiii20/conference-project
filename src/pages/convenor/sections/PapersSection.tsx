import { SubmissionsTab } from '../SubmissionsTab'
import { ReviewSettingsTab } from '../ReviewSettingsTab'
import { SECTIONS } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

export function PapersSection({ conferenceId, basePath }: { conferenceId: string; basePath: string }) {
  const section = SECTIONS.find((s) => s.id === 'papers')!
  return (
    <TabbedSection
      basePath={basePath}
      tabs={section.tabs.map((t) => ({
        ...t,
        element:
          t.id === 'settings' ? (
            <ReviewSettingsTab conferenceId={conferenceId} />
          ) : (
            // "Submissions" and "Reviews and decisions" are the same underlying
            // screen (the detail panel already covers assigning reviewers and
            // recording decisions) — two sidebar entries into one feature.
            <SubmissionsTab conferenceId={conferenceId} />
          ),
      }))}
    />
  )
}
