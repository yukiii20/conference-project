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
