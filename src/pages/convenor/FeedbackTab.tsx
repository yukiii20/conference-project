import { useState } from 'react'
import { PageHeader, Tabs } from '../../components/ui'
import { AudienceFeedbackPanel } from './AudienceFeedbackPanel'
import { FeedbackSurveyTab } from './FeedbackSurveyTab'

/**
 * The convenor "Feedback" tab: the Audience's conference feedback and session ratings, next
 * to the existing feedback survey (unchanged, now the second sub-tab).
 */
export function FeedbackTab({ conferenceId }: { conferenceId: string }) {
  const [tab, setTab] = useState<'audience' | 'survey'>('audience')
  return (
    <div>
      <div className="mt-6">
        <Tabs
          tabs={[
            { id: 'audience', label: 'Audience feedback' },
            { id: 'survey', label: 'Feedback survey' },
          ]}
          active={tab}
          onChange={(id) => setTab(id as 'audience' | 'survey')}
        />
      </div>
      {tab === 'audience' ? (
        <div className="mt-4">
          <PageHeader title="Audience feedback" subtitle="Conference feedback and session ratings from the Audience. Only organisers see this." />
          <div className="mt-4">
            <AudienceFeedbackPanel conferenceId={conferenceId} />
          </div>
        </div>
      ) : (
        <FeedbackSurveyTab conferenceId={conferenceId} />
      )}
    </div>
  )
}
