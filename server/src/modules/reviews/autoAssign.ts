export type AutoAssignBid = 'want' | 'can' | 'not_interested' | 'conflict'

export type AutoAssignPaper = {
  submissionId: string
  trackId: string
  /** Reviewers already actively assigned to this paper this round (assigned/in_progress/completed). */
  alreadyAssignedReviewerIds: string[]
  /** The paper's own author(s) - always excluded, regardless of bid. */
  excludedReviewerIds: string[]
}

export type AutoAssignReviewer = {
  reviewerId: string
  /** reviewer_tracks preferences for this conference; empty means none set. */
  trackIds: string[]
  /** Active assignment count before this run. */
  existingLoad: number
  /** This reviewer's bid per submission id, where one was made. */
  bids: Record<string, AutoAssignBid>
}

export type AutoAssignInput = {
  papers: AutoAssignPaper[]
  reviewers: AutoAssignReviewer[]
  reviewersPerPaper: number
  maxPapersPerReviewer: number
  /** true = skip any paper that already has at least one active reviewer. */
  onlyUnassigned: boolean
}

export type AutoAssignProposedAssignment = {
  submissionId: string
  reviewerId: string
  reason: string
}

export type AutoAssignWarning = {
  submissionId: string
  message: string
}

export type AutoAssignReviewerLoad = {
  reviewerId: string
  assignedCount: number
  totalLoad: number
}

export type AutoAssignResult = {
  assignments: AutoAssignProposedAssignment[]
  reviewerLoads: AutoAssignReviewerLoad[]
  warnings: AutoAssignWarning[]
}

function bidRank(bid: AutoAssignBid | undefined): number {
  if (bid === 'want') return 0
  if (bid === 'can') return 1
  if (bid === undefined) return 2
  if (bid === 'not_interested') return 3
  return 4 // 'conflict' - never chosen, see eligibility check below
}

function describeReason(bid: AutoAssignBid | undefined, trackMatch: boolean): string {
  const bidText =
    bid === 'want'
      ? 'Bid: wants to review'
      : bid === 'can'
        ? 'Bid: can review'
        : bid === 'not_interested'
          ? 'No other reviewer available (bid: not interested)'
          : 'No bid received'
  return trackMatch ? `${bidText}, track match` : bidText
}

/**
 * Deterministic greedy assignment with load balancing. For each paper (in a
 * stable id order), ranks eligible reviewers by bid (want > can > no bid >
 * not_interested, never conflict), then by track match (only when at least
 * one reviewer in the conference has set a track preference at all), then by
 * current simulated load (ascending, for even spreading), then by id for a
 * stable tie-break - and takes however many are still needed. Pure function,
 * no I/O, so it's cheap to unit test on small fixtures.
 */
export function planAutoAssignment(input: AutoAssignInput): AutoAssignResult {
  const { papers, reviewers, reviewersPerPaper, maxPapersPerReviewer, onlyUnassigned } = input
  const anyTrackPrefsExist = reviewers.some((r) => r.trackIds.length > 0)
  const load = new Map(reviewers.map((r) => [r.reviewerId, r.existingLoad]))

  const assignments: AutoAssignProposedAssignment[] = []
  const warnings: AutoAssignWarning[] = []

  const orderedPapers = [...papers]
    .filter((p) => !onlyUnassigned || p.alreadyAssignedReviewerIds.length === 0)
    .sort((a, b) => a.submissionId.localeCompare(b.submissionId))

  for (const paper of orderedPapers) {
    const needed = Math.max(0, reviewersPerPaper - paper.alreadyAssignedReviewerIds.length)
    if (needed === 0) continue

    const excluded = new Set([...paper.excludedReviewerIds, ...paper.alreadyAssignedReviewerIds])

    const candidates = reviewers
      .filter((r) => !excluded.has(r.reviewerId))
      .filter((r) => r.bids[paper.submissionId] !== 'conflict')
      .filter((r) => (load.get(r.reviewerId) ?? 0) < maxPapersPerReviewer)
      .map((r) => ({
        reviewer: r,
        bid: r.bids[paper.submissionId],
        trackMatch: anyTrackPrefsExist ? r.trackIds.includes(paper.trackId) : true,
      }))
      .sort((a, b) => {
        const ba = bidRank(a.bid)
        const bb = bidRank(b.bid)
        if (ba !== bb) return ba - bb
        if (a.trackMatch !== b.trackMatch) return a.trackMatch ? -1 : 1
        const la = load.get(a.reviewer.reviewerId) ?? 0
        const lb = load.get(b.reviewer.reviewerId) ?? 0
        if (la !== lb) return la - lb
        return a.reviewer.reviewerId.localeCompare(b.reviewer.reviewerId)
      })

    const chosen = candidates.slice(0, needed)
    for (const c of chosen) {
      assignments.push({
        submissionId: paper.submissionId,
        reviewerId: c.reviewer.reviewerId,
        reason: describeReason(c.bid, anyTrackPrefsExist && c.trackMatch),
      })
      load.set(c.reviewer.reviewerId, (load.get(c.reviewer.reviewerId) ?? 0) + 1)
    }

    if (chosen.length < needed) {
      warnings.push({
        submissionId: paper.submissionId,
        message: `Needed ${needed} more reviewer(s); only found ${chosen.length}.`,
      })
    }
  }

  const reviewerLoads: AutoAssignReviewerLoad[] = reviewers.map((r) => {
    const totalLoad = load.get(r.reviewerId) ?? r.existingLoad
    return { reviewerId: r.reviewerId, assignedCount: totalLoad - r.existingLoad, totalLoad }
  })

  return { assignments, reviewerLoads, warnings }
}
