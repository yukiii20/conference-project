import { useState } from 'react'
import { PageHeader } from '../../components/ui'
import { TemplatesSection } from './certificates/TemplatesSection'
import { IssueSection } from './certificates/IssueSection'
import { IssuedListSection } from './certificates/IssuedListSection'

export function CertificatesTab({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="mt-6 max-w-5xl">
      <PageHeader title="Certificates" subtitle="Design certificate templates, issue them in bulk, and release them to recipients." />
      <TemplatesSection conferenceId={conferenceId} onChanged={() => setRefreshKey((k) => k + 1)} />
      <IssueSection conferenceId={conferenceId} onIssued={() => setRefreshKey((k) => k + 1)} />
      <IssuedListSection conferenceId={conferenceId} refreshKey={refreshKey} />
    </div>
  )
}
