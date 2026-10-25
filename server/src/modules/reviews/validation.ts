import { z } from 'zod'

export const listSubmissionsQuerySchema = z.object({
  status: z.string().optional(),
  track_id: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
})
export type ListSubmissionsQuery = z.infer<typeof listSubmissionsQuerySchema>

export const assignReviewerSchema = z.object({
  reviewer_id: z.string().min(1, 'Choose a reviewer.').uuid('Choose a reviewer.'),
  due_at: z.string().min(1, 'Choose a due date.'),
})
export type AssignReviewerInput = z.infer<typeof assignReviewerSchema>

export const cancelAssignmentSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason.').max(500, 'Reason must be 500 characters or fewer.'),
})
export type CancelAssignmentInput = z.infer<typeof cancelAssignmentSchema>

export const addConflictSchema = z.object({
  submission_id: z.string().uuid(),
  user_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
})
export type AddConflictInput = z.infer<typeof addConflictSchema>

export const DECISIONS = ['accepted', 'rejected', 'revision_required'] as const
export const DECISION_STAGES = ['abstract', 'full_paper', 'final_approval'] as const

export const decisionSchema = z.object({
  stage: z.enum(DECISION_STAGES),
  decision: z.enum(DECISIONS),
  comments_to_author: z.string().trim().max(5000).optional().nullable(),
  internal_notes: z.string().trim().max(5000).optional().nullable(),
})
export type DecisionInput = z.infer<typeof decisionSchema>

export const reviewerAssignmentActionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})
export type ReviewerAssignmentActionInput = z.infer<typeof reviewerAssignmentActionSchema>

const reviewScore = z.coerce.number().int('Whole numbers only.').min(1).max(5)
const reviewScoreOptional = reviewScore.optional().nullable()

export const RECOMMENDATIONS = ['accept', 'minor_revision', 'major_revision', 'reject'] as const

export const saveReviewDraftSchema = z.object({
  originality: reviewScoreOptional,
  quality: reviewScoreOptional,
  relevance: reviewScoreOptional,
  methodology: reviewScoreOptional,
  overall_score: reviewScoreOptional,
  confidence: reviewScoreOptional,
  recommendation: z.enum(RECOMMENDATIONS).optional().nullable(),
  comments_to_author: z.string().trim().max(5000).optional().nullable(),
  confidential_comments: z.string().trim().max(5000).optional().nullable(),
})
export type SaveReviewDraftInput = z.infer<typeof saveReviewDraftSchema>

export const BID_PREFERENCES = ['want', 'can', 'not_interested', 'conflict'] as const

export const listBiddableQuerySchema = z.object({
  conference_id: z.string().uuid(),
  track_id: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
})
export type ListBiddableQuery = z.infer<typeof listBiddableQuerySchema>

export const upsertBidSchema = z.object({
  preference: z.enum(BID_PREFERENCES),
})
export type UpsertBidInput = z.infer<typeof upsertBidSchema>

export const autoAssignPreviewSchema = z.object({
  reviewers_per_paper: z.number().int().min(1).max(10),
  max_papers_per_reviewer: z.number().int().min(1).max(50),
  only_unassigned: z.boolean(),
})
export type AutoAssignPreviewInput = z.infer<typeof autoAssignPreviewSchema>

export const autoAssignConfirmSchema = z.object({
  due_at: z.string().min(1, 'Choose a due date.'),
  assignments: z
    .array(
      z.object({
        submission_id: z.string().uuid(),
        reviewer_id: z.string().uuid(),
      }),
    )
    .min(1, 'Nothing to confirm.'),
})
export type AutoAssignConfirmInput = z.infer<typeof autoAssignConfirmSchema>

export const submitReviewSchema = z.object({
  originality: reviewScore,
  quality: reviewScore,
  relevance: reviewScore,
  methodology: reviewScore,
  overall_score: reviewScore,
  confidence: reviewScore,
  recommendation: z.enum(RECOMMENDATIONS),
  comments_to_author: z.string().trim().min(1, 'Add comments for the author.').max(5000),
  confidential_comments: z.string().trim().max(5000).optional().nullable(),
})
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>
