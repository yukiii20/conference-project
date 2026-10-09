const REPORTS: Array<{ kind: string; label: string; description: string }> = [
  { kind: 'submissions', label: 'Submissions', description: 'Code, title, track, status, authors, average score, decision.' },
  { kind: 'reviews', label: 'Reviews', description: 'Paper, reviewer, scores, recommendation (confidential comments only if you can see all reviews).' },
  { kind: 'members', label: 'Members', description: 'Name, email, role, status, joined date.' },
  { kind: 'committees', label: 'Committees', description: 'Committee, type, member, role, affiliation, country.' },
]

export function ReportsTab({ conferenceId }: { conferenceId: string }) {
  return (
    <div className="mt-6 max-w-2xl space-y-3">
      {REPORTS.map((r) => (
        <div key={r.kind} className="rounded-lg border border-line bg-white p-4">
          <p className="font-medium text-ink">{r.label}</p>
          <p className="mt-1 text-sm text-ink/60">{r.description}</p>
          <div className="mt-3 flex gap-2">
            <a
              href={`/api/conferences/${conferenceId}/reports/${r.kind}/csv`}
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background"
            >
              Download CSV
            </a>
            <a
              href={`/api/conferences/${conferenceId}/reports/${r.kind}/xlsx`}
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background"
            >
              Download Excel
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}
