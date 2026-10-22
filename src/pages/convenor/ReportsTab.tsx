import { PageHeader, Card } from '../../components/ui'

const REPORTS: Array<{ kind: string; label: string; description: string }> = [
  { kind: 'submissions', label: 'Submissions', description: 'Code, title, track, status, authors, average score, decision.' },
  { kind: 'reviews', label: 'Reviews', description: 'Paper, reviewer, scores, recommendation (confidential comments only if you can see all reviews).' },
  { kind: 'members', label: 'Members', description: 'Name, email, role, status, joined date.' },
  { kind: 'committees', label: 'Committees', description: 'Committee, type, member, role, affiliation, country.' },
]

export function ReportsTab({ conferenceId }: { conferenceId: string }) {
  return (
    <div className="mt-6 max-w-2xl space-y-3">
      <PageHeader title="Reports" subtitle="Download CSV or Excel exports of conference data." />
      {REPORTS.map((r) => (
        <Card key={r.kind}>
          <p className="font-medium text-text">{r.label}</p>
          <p className="mt-1 text-sm text-text-muted">{r.description}</p>
          <div className="mt-3 flex gap-2">
            <a
              href={`/api/conferences/${conferenceId}/reports/${r.kind}/csv`}
              className="rounded-md border border-button px-3 py-1.5 text-sm text-button hover:bg-outline-hover"
            >
              Download CSV
            </a>
            <a
              href={`/api/conferences/${conferenceId}/reports/${r.kind}/xlsx`}
              className="rounded-md border border-button px-3 py-1.5 text-sm text-button hover:bg-outline-hover"
            >
              Download Excel
            </a>
          </div>
        </Card>
      ))}
    </div>
  )
}
