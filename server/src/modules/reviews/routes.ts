import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  acceptAssignment,
  addConflict,
  assignReviewer,
  cancelAssignment,
  declareConflictAndDecline,
  declineAssignment,
  getAssignmentDetail,
  getSubmissionOverviewDetail,
  listMyAssignments,
  listReviewerCandidates,
  listSubmissionsOverview,
  recordDecision,
  saveReviewDraft,
  submitReview,
} from './service.js'
import {
  addConflictSchema,
  assignReviewerSchema,
  cancelAssignmentSchema,
  decisionSchema,
  listSubmissionsQuerySchema,
  reviewerAssignmentActionSchema,
  saveReviewDraftSchema,
  submitReviewSchema,
} from './validation.js'

export const reviewsConferenceRouter = Router()

// --- B1. Convenor/manager submissions overview ---------------------------

reviewsConferenceRouter.get(
  '/:id/submissions',
  requireAuth,
  validateQuery(listSubmissionsQuerySchema),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { status?: string; track_id?: string; q?: string }
      const submissions = await listSubmissionsOverview(req.user!.id, req.params.id!, query)
      res.json({ submissions })
    } catch (err) {
      next(err)
    }
  },
)

reviewsConferenceRouter.get('/:id/submissions/:sid', requireAuth, async (req, res, next) => {
  try {
    res.json(await getSubmissionOverviewDetail(req.user!.id, req.params.id!, req.params.sid!))
  } catch (err) {
    next(err)
  }
})

// --- B2. Assigning reviewers ----------------------------------------------

reviewsConferenceRouter.get('/:id/reviewers', requireAuth, async (req, res, next) => {
  try {
    const submissionId = req.query.submission_id as string | undefined
    if (!submissionId) {
      res.status(400).json({ error: { message: 'submission_id is required.' } })
      return
    }
    res.json({ reviewers: await listReviewerCandidates(req.user!.id, req.params.id!, submissionId) })
  } catch (err) {
    next(err)
  }
})

reviewsConferenceRouter.post(
  '/:id/submissions/:sid/assignments',
  requireAuth,
  validateBody(assignReviewerSchema),
  async (req, res, next) => {
    try {
      const result = await assignReviewer(req.user!.id, req.params.id!, req.params.sid!, req.body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  },
)

reviewsConferenceRouter.delete(
  '/:id/assignments/:aid',
  requireAuth,
  validateBody(cancelAssignmentSchema),
  async (req, res, next) => {
    try {
      await cancelAssignment(req.user!.id, req.params.id!, req.params.aid!, req.body.reason)
      res.json({ message: 'Assignment cancelled.' })
    } catch (err) {
      next(err)
    }
  },
)

reviewsConferenceRouter.post(
  '/:id/conflicts',
  requireAuth,
  validateBody(addConflictSchema),
  async (req, res, next) => {
    try {
      const result = await addConflict(req.user!.id, req.params.id!, req.body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  },
)

// --- B4. Decisions ----------------------------------------------------------

reviewsConferenceRouter.post(
  '/:id/submissions/:sid/decisions',
  requireAuth,
  validateBody(decisionSchema),
  async (req, res, next) => {
    try {
      await recordDecision(req.user!.id, req.params.id!, req.params.sid!, req.body)
      res.status(201).json({ message: 'Decision recorded.' })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// B3. Reviewer portal
// ---------------------------------------------------------------------------

export const reviewerRouter = Router()

reviewerRouter.get('/assignments', requireAuth, async (req, res, next) => {
  try {
    const conferenceId = req.query.conference_id as string | undefined
    res.json({ assignments: await listMyAssignments(req.user!.id, conferenceId) })
  } catch (err) {
    next(err)
  }
})

reviewerRouter.get('/assignments/:aid', requireAuth, async (req, res, next) => {
  try {
    res.json(await getAssignmentDetail(req.user!.id, req.params.aid!))
  } catch (err) {
    next(err)
  }
})

reviewerRouter.post('/assignments/:aid/accept', requireAuth, async (req, res, next) => {
  try {
    await acceptAssignment(req.user!.id, req.params.aid!)
    res.json({ message: 'Assignment accepted.' })
  } catch (err) {
    next(err)
  }
})

reviewerRouter.post(
  '/assignments/:aid/decline',
  requireAuth,
  validateBody(reviewerAssignmentActionSchema),
  async (req, res, next) => {
    try {
      await declineAssignment(req.user!.id, req.params.aid!, req.body.reason)
      res.json({ message: 'Assignment declined.' })
    } catch (err) {
      next(err)
    }
  },
)

reviewerRouter.post(
  '/assignments/:aid/conflict',
  requireAuth,
  validateBody(reviewerAssignmentActionSchema),
  async (req, res, next) => {
    try {
      await declareConflictAndDecline(req.user!.id, req.params.aid!, req.body.reason)
      res.json({ message: 'Conflict declared.' })
    } catch (err) {
      next(err)
    }
  },
)

reviewerRouter.put(
  '/assignments/:aid/review',
  requireAuth,
  validateBody(saveReviewDraftSchema),
  async (req, res, next) => {
    try {
      await saveReviewDraft(req.user!.id, req.params.aid!, req.body)
      res.json({ message: 'Draft saved.' })
    } catch (err) {
      next(err)
    }
  },
)

reviewerRouter.post(
  '/assignments/:aid/review/submit',
  requireAuth,
  validateBody(submitReviewSchema),
  async (req, res, next) => {
    try {
      await submitReview(req.user!.id, req.params.aid!, req.body)
      res.json({ message: 'Review submitted.' })
    } catch (err) {
      next(err)
    }
  },
)
