import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { useToast } from '../../components/ui/Toast'
import { Alert, Badge, Button, Card, EmptyState, Select, SkeletonText, Input } from '../../components/ui'

type BiddableSubmission = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  track_id: string
  track_name: string
  bid: 'want' | 'can' | 'not_interested' | 'conflict' | null
}

type BidsResponse = {
  bidding_open: boolean
  bidding_start_at: string | null
  bidding_end_at: string | null
  bid_count: number
  total_count: number
  submissions: BiddableSubmission[]
}

const PREFERENCES = [
  { value: 'want', label: 'Want to review' },
  { value: 'can', label: 'Can review' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'conflict', label: 'Conflict of interest' },
] as const

export function BidOnPapersTab({ conferenceId }: { conferenceId: string }) {
  // Reviewers have no permission to call the convenor-only /tracks endpoint,
  // so the filter's options are built up from whatever tracks have shown up
  // in a bids response so far (additive, never shrinks when a track filter
  // narrows the submissions list itself).
  const [tracks, setTracks] = useState<Map<string, string>>(new Map())
  const [trackFilter, setTrackFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [data, setData] = useState<BidsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const bidsData = await api.get<BidsResponse>('/reviewer/bids', {
        conference_id: conferenceId,
        track_id: trackFilter || undefined,
        q: debouncedSearch || undefined,
      })
      setTracks((prev) => {
        const next = new Map(prev)
        for (const s of bidsData.submissions) next.set(s.track_id, s.track_name)
        return next
      })
      setData(bidsData)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load papers to bid on.')
    }
    setLoading(false)
  }, [conferenceId, trackFilter, debouncedSearch])

  useEffect(() => {
    load()
  }, [load])

  async function handleBid(submissionId: string, preference: (typeof PREFERENCES)[number]['value']) {
    setSavingId(submissionId)
    try {
      await api.put(`/reviewer/bids/${submissionId}`, { preference })
      showToast('Bid saved.', 'success')
      setData((prev) =>
        prev
          ? {
              ...prev,
              bid_count: prev.submissions.find((s) => s.id === submissionId)?.bid ? prev.bid_count : prev.bid_count + 1,
              submissions: prev.submissions.map((s) => (s.id === submissionId ? { ...s, bid: preference } : s)),
            }
          : prev,
      )
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save this bid.', 'error')
    }
    setSavingId(null)
  }

  if (loading && !data) {
    return (
      <Card className="mt-6">
        <SkeletonText lines={5} />
      </Card>
    )
  }
  if (error || !data) return <Alert variant="danger">{error ?? 'Could not load papers to bid on.'}</Alert>

  return (
    <div className="mt-6">
      <p className="text-sm font-medium text-text">
        You have bid on {data.bid_count} of {data.total_count} papers.
      </p>

      {!data.bidding_open ? (
        <div className="mt-3">
          <Alert variant="warning">
            Bidding isn't open right now
            {data.bidding_start_at && data.bidding_end_at
              ? ` (open ${formatKathmandu(data.bidding_start_at)} to ${formatKathmandu(data.bidding_end_at)}).`
              : '.'}
          </Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <Input placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        <Select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} className="w-auto">
          <option value="">All tracks</option>
          {[...tracks.entries()].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      {data.submissions.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            title="No papers to bid on."
            message={trackFilter || search ? 'Try a different track or search.' : 'There are no eligible papers yet.'}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {data.submissions.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text">
                    {s.title} {s.submission_code ? <Badge>{s.submission_code}</Badge> : null}
                  </p>
                  <p className="text-xs text-text-muted">{s.track_name}</p>
                </div>
              </div>
              <p className="mt-2 text-sm text-text/90">{s.abstract}</p>
              {s.keywords.length > 0 ? (
                <p className="mt-1 text-xs text-text-muted">Keywords: {s.keywords.join(', ')}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {PREFERENCES.map((p) => (
                  <Button
                    key={p.value}
                    type="button"
                    size="sm"
                    variant={s.bid === p.value ? 'primary' : 'secondary'}
                    disabled={!data.bidding_open || savingId === s.id}
                    onClick={() => handleBid(s.id, p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
