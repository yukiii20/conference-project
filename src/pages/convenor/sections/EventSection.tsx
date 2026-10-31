import { ProgrammeTab } from '../ProgrammeTab'
import { AttendanceTab } from '../AttendanceTab'
import { CertificatesTab } from '../CertificatesTab'
import { AbstractBookTab } from '../AbstractBookTab'
import { FeedbackSurveyTab } from '../FeedbackSurveyTab'
import { SECTIONS } from '../sidebarConfig'
import { TabbedSection } from './TabbedSection'

const ELEMENTS: Record<string, (conferenceId: string, basePath: string) => React.ReactNode> = {
  programme: (conferenceId) => <ProgrammeTab conferenceId={conferenceId} />,
  attendance: (conferenceId) => <AttendanceTab conferenceId={conferenceId} />,
  certificates: (conferenceId) => <CertificatesTab conferenceId={conferenceId} />,
  abstracts: (conferenceId, basePath) => (
    <AbstractBookTab conferenceId={conferenceId} submissionsPath={`${basePath.replace(/\/event$/, '')}/papers/submissions`} />
  ),
  feedback: (conferenceId) => <FeedbackSurveyTab conferenceId={conferenceId} />,
}

export function EventSection({ conferenceId, basePath }: { conferenceId: string; basePath: string }) {
  const section = SECTIONS.find((s) => s.id === 'event')!
  return (
    <TabbedSection
      basePath={basePath}
      tabs={section.tabs.map((t) => ({
        ...t,
        element: ELEMENTS[t.id]?.(conferenceId, basePath) ?? null,
      }))}
    />
  )
}
