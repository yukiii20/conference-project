import { describe, expect, it } from 'vitest'
import { planAutoAssignment, type AutoAssignReviewer } from '../src/modules/reviews/autoAssign.js'

function reviewer(id: string, overrides: Partial<AutoAssignReviewer> = {}): AutoAssignReviewer {
  return { reviewerId: id, trackIds: [], existingLoad: 0, bids: {}, ...overrides }
}

describe('planAutoAssignment', () => {
  it('prefers "want" over "can" over no bid, and never picks a declared conflict', () => {
    const result = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] }],
      reviewers: [
        reviewer('r1', { bids: { p1: 'conflict' } }),
        reviewer('r2', { bids: { p1: 'can' } }),
        reviewer('r3', { bids: { p1: 'want' } }),
        reviewer('r4'), // no bid
      ],
      reviewersPerPaper: 2,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(result.assignments.map((a) => a.reviewerId)).toEqual(['r3', 'r2'])
    expect(result.warnings).toHaveLength(0)
  })

  it('uses "not_interested" only when there are not enough better candidates', () => {
    const result = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] }],
      reviewers: [reviewer('r1', { bids: { p1: 'want' } }), reviewer('r2', { bids: { p1: 'not_interested' } })],
      reviewersPerPaper: 2,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(result.assignments.map((a) => a.reviewerId).sort()).toEqual(['r1', 'r2'])
  })

  it('never not_interested when enough better candidates exist', () => {
    const result = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] }],
      reviewers: [
        reviewer('r1', { bids: { p1: 'want' } }),
        reviewer('r2', { bids: { p1: 'not_interested' } }),
        reviewer('r3'), // no bid - still beats not_interested
      ],
      reviewersPerPaper: 2,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(result.assignments.map((a) => a.reviewerId).sort()).toEqual(['r1', 'r3'])
  })

  it('excludes the paper\'s own author even with a "want" bid', () => {
    const result = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: ['r1'] }],
      reviewers: [reviewer('r1', { bids: { p1: 'want' } }), reviewer('r2')],
      reviewersPerPaper: 1,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(result.assignments.map((a) => a.reviewerId)).toEqual(['r2'])
  })

  it('tops up only the missing slots on a paper that already has some reviewers', () => {
    const result = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: ['r1', 'r2'], excludedReviewerIds: [] }],
      reviewers: [reviewer('r1'), reviewer('r2'), reviewer('r3'), reviewer('r4')],
      reviewersPerPaper: 3,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(result.assignments).toHaveLength(1)
    expect(['r3', 'r4']).toContain(result.assignments[0]!.reviewerId)
  })

  it('onlyUnassigned skips any paper that already has at least one active reviewer', () => {
    const result = planAutoAssignment({
      papers: [
        { submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: ['r1'], excludedReviewerIds: [] },
        { submissionId: 'p2', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] },
      ],
      reviewers: [reviewer('r1'), reviewer('r2')],
      reviewersPerPaper: 1,
      maxPapersPerReviewer: 10,
      onlyUnassigned: true,
    })
    expect(result.assignments.map((a) => a.submissionId)).toEqual(['p2'])
  })

  it('respects maxPapersPerReviewer and reports a warning when nobody is left', () => {
    const result = planAutoAssignment({
      papers: [
        { submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] },
        { submissionId: 'p2', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] },
      ],
      reviewers: [reviewer('r1')],
      reviewersPerPaper: 1,
      maxPapersPerReviewer: 1,
      onlyUnassigned: false,
    })
    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0]!.submissionId).toBe('p1')
    expect(result.warnings).toEqual([{ submissionId: 'p2', message: 'Needed 1 more reviewer(s); only found 0.' }])
  })

  it('spreads load evenly among equally-ranked candidates', () => {
    const result = planAutoAssignment({
      papers: [
        { submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] },
        { submissionId: 'p2', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] },
      ],
      reviewers: [reviewer('r1'), reviewer('r2')],
      reviewersPerPaper: 1,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    // p1 picks r1 (tie-break by id), which raises r1's simulated load - so p2 should then prefer r2.
    expect(result.assignments).toEqual([
      { submissionId: 'p1', reviewerId: 'r1', reason: 'No bid received' },
      { submissionId: 'p2', reviewerId: 'r2', reason: 'No bid received' },
    ])
  })

  it('prefers a track match, but only when at least one reviewer has set a track preference', () => {
    const withPrefs = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 'track-A', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] }],
      reviewers: [reviewer('r1', { trackIds: ['track-B'] }), reviewer('r2', { trackIds: ['track-A'] })],
      reviewersPerPaper: 1,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(withPrefs.assignments.map((a) => a.reviewerId)).toEqual(['r2'])

    // No reviewer has any track preference at all - track matching must be ignored entirely.
    const noPrefs = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 'track-A', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] }],
      reviewers: [reviewer('r2'), reviewer('r1')],
      reviewersPerPaper: 1,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(noPrefs.assignments.map((a) => a.reviewerId)).toEqual(['r1'])
  })

  it('is deterministic - the same input always produces the same output', () => {
    const input = {
      papers: [
        { submissionId: 'p2', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] },
        { submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] },
      ],
      reviewers: [reviewer('r2', { bids: { p1: 'can' as const } }), reviewer('r1', { bids: { p1: 'want' as const } })],
      reviewersPerPaper: 1,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    }
    expect(planAutoAssignment(input)).toEqual(planAutoAssignment(input))
  })

  it('returns no assignments and a warning per paper when there are no reviewers at all', () => {
    const result = planAutoAssignment({
      papers: [{ submissionId: 'p1', trackId: 't1', alreadyAssignedReviewerIds: [], excludedReviewerIds: [] }],
      reviewers: [],
      reviewersPerPaper: 2,
      maxPapersPerReviewer: 10,
      onlyUnassigned: false,
    })
    expect(result.assignments).toHaveLength(0)
    expect(result.warnings).toEqual([{ submissionId: 'p1', message: 'Needed 2 more reviewer(s); only found 0.' }])
  })
})
