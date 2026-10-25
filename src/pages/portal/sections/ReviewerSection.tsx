import { useState } from 'react'
import { AssignmentsList } from '../../reviewer/AssignmentsList'
import { BidOnPapersTab } from '../../reviewer/BidOnPapersTab'
import { ReviewForm } from '../../reviewer/ReviewForm'
import { Button, PageHeader } from '../../../components/ui'

export function ReviewerSection({ conferenceId }: { conferenceId: string }) {
  const [tab, setTab] = useState<'assignments' | 'bids'>('assignments')
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
        <>
          <div className="flex gap-1 border-b border-border">
            {(
              [
                { id: 'assignments', label: 'My assignments' },
                { id: 'bids', label: 'Bid on papers' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'true' : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  tab === t.id ? 'border-brand text-brand' : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'assignments' ? (
            <AssignmentsList conferenceId={conferenceId} onOpen={setOpen} refreshKey={refreshKey} />
          ) : (
            <BidOnPapersTab conferenceId={conferenceId} />
          )}
        </>
      )}
    </div>
  )
}
