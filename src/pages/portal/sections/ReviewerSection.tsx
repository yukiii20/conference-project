import { useState } from 'react'
import { AssignmentsList } from '../../reviewer/AssignmentsList'
import { ReviewForm } from '../../reviewer/ReviewForm'

export function ReviewerSection({ conferenceId }: { conferenceId: string }) {
  const [open, setOpen] = useState<{ assignmentId: string; submissionId: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="mt-6 max-w-3xl">
      <h2 className="text-lg font-medium text-ink">My reviews</h2>

      {open ? (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(null)
              setRefreshKey((k) => k + 1)
            }}
            className="mt-4 text-sm text-button underline"
          >
            ← Back to my assignments
          </button>
          <ReviewForm assignmentId={open.assignmentId} submissionId={open.submissionId} />
        </>
      ) : (
        <AssignmentsList conferenceId={conferenceId} onOpen={setOpen} refreshKey={refreshKey} />
      )}
    </div>
  )
}
