import { useState } from 'react'
import { AssignmentsList } from '../../reviewer/AssignmentsList'
import { ReviewForm } from '../../reviewer/ReviewForm'
import { Button, PageHeader } from '../../../components/ui'

export function ReviewerSection({ conferenceId }: { conferenceId: string }) {
  const [open, setOpen] = useState<{ assignmentId: string; submissionId: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="My reviews" subtitle="Papers assigned to you for review, and your submitted scores." />

      {open ? (
        <>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setOpen(null)
              setRefreshKey((k) => k + 1)
            }}
            className="mt-4"
          >
            ← Back to my assignments
          </Button>
          <ReviewForm assignmentId={open.assignmentId} submissionId={open.submissionId} />
        </>
      ) : (
        <AssignmentsList conferenceId={conferenceId} onOpen={setOpen} refreshKey={refreshKey} />
      )}
    </div>
  )
}
