import { Router } from 'express'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'
import { auditContextFrom } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import { validateBody } from '../../middleware/validate.js'
import { qaAskRateLimit, qaVoteRateLimit } from '../../middleware/rateLimit.js'
import {
  askQuestion,
  askQuestionSchema,
  assertCanModerate,
  listAudienceQuestions,
  listModeratorQuestions,
  moderateQuestion,
  moderateQuestionSchema,
  parseSort,
  setVote,
} from './qa.js'
import {
  assertFullScope,
  conferenceFeedbackSchema,
  feedbackCsv,
  getFeedbackScope,
  getFeedbackSummary,
  getMyFeedback,
  moderateFeedback,
  moderateFeedbackSchema,
  parseFeedbackFilters,
  saveConferenceFeedback,
  saveSessionRating,
  sessionRatingSchema,
} from './feedback.js'
import { getAudienceProgramme, getAudienceSpeakers, joinOnline } from './programme.js'
import { resendTicketEmail } from './ticket.js'
import { getMyTicket } from './ticketService.js'

/**
 * Audience features, mounted at /api/conferences. Every route is either the caller's OWN data
 * (requireAuth + "own row" in the service, like my-registration) or guarded by an
 * audience.* permission (requireConferencePermission) - see tests/audienceMatrix.test.ts.
 */
export const audienceRouter = Router()

// ------------------------------------------------------------------ Ticket
audienceRouter.get('/:id/my-ticket', requireAuth, async (req, res, next) => {
  try {
    const ticket = await getMyTicket(req.params.id!, req.user!.id)
    if (!ticket) throw new NotFoundError('You do not have an active registration for this conference.')
    res.setHeader('Cache-Control', 'no-store')
    res.json(ticket)
  } catch (err) {
    next(err)
  }
})

audienceRouter.post('/:id/my-ticket/email', requireAuth, async (req, res, next) => {
  try {
    assertConferenceInSession(req.params.id!)
    await resendTicketEmail(req.params.id!, req.user!.id, auditContextFrom(req))
    res.json({ message: 'Your ticket is on its way to your email.' })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Programme & speakers
audienceRouter.get('/:id/audience/programme', requireConferencePermission('audience.view_content'), async (req, res, next) => {
  try {
    res.json(await getAudienceProgramme(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

audienceRouter.get('/:id/audience/speakers', requireConferencePermission('audience.view_content'), async (req, res, next) => {
  try {
    res.json({ speakers: await getAudienceSpeakers(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

// "Join online": returns the private link (never cached) and records online attendance.
audienceRouter.post(
  '/:id/audience/sessions/:sessionId/join-online',
  requireConferencePermission('audience.view_content'),
  async (req, res, next) => {
    try {
      const result = await joinOnline(req.params.id!, req.params.sessionId!, req.user!.id)
      res.setHeader('Cache-Control', 'no-store')
      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Q&A (Audience)
audienceRouter.get(
  '/:id/audience/sessions/:sessionId/questions',
  requireConferencePermission('audience.view_content'),
  async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json(await listAudienceQuestions(req.params.id!, req.params.sessionId!, req.user!.id, parseSort(req.query.sort)))
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.post(
  '/:id/audience/sessions/:sessionId/questions',
  requireConferencePermission('audience.ask_question'),
  qaAskRateLimit,
  validateBody(askQuestionSchema),
  async (req, res, next) => {
    try {
      const { id } = await askQuestion(req.params.id!, req.params.sessionId!, req.user!.id, req.body)
      res.status(201).json({ id, message: 'Your question has been posted.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.put(
  '/:id/audience/questions/:questionId/vote',
  requireConferencePermission('audience.ask_question'),
  qaVoteRateLimit,
  async (req, res, next) => {
    try {
      res.json(await setVote(req.params.id!, req.params.questionId!, req.user!.id, true))
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.delete(
  '/:id/audience/questions/:questionId/vote',
  requireConferencePermission('audience.ask_question'),
  qaVoteRateLimit,
  async (req, res, next) => {
    try {
      res.json(await setVote(req.params.id!, req.params.questionId!, req.user!.id, false))
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Q&A moderation
// The session's chair/co-chair, or audience.moderate (convenor, manager). Not a single
// permission, so requireAuth + assertCanModerate (same pattern as the chair attendance view).
audienceRouter.get('/:id/sessions/:sessionId/questions/moderate', requireAuth, async (req, res, next) => {
  try {
    await assertCanModerate(req.user!.id, req.params.id!, req.params.sessionId!)
    const status = ['visible', 'answered', 'hidden'].includes(String(req.query.status))
      ? (req.query.status as 'visible' | 'answered' | 'hidden')
      : undefined
    res.setHeader('Cache-Control', 'no-store')
    res.json(await listModeratorQuestions(req.params.id!, req.params.sessionId!, parseSort(req.query.sort), status))
  } catch (err) {
    next(err)
  }
})

audienceRouter.patch(
  '/:id/sessions/:sessionId/questions/:questionId',
  requireAuth,
  validateBody(moderateQuestionSchema),
  async (req, res, next) => {
    try {
      await assertCanModerate(req.user!.id, req.params.id!, req.params.sessionId!)
      await moderateQuestion(req.user!.id, req.params.id!, req.params.sessionId!, req.params.questionId!, req.body.status, auditContextFrom(req))
      res.json({ message: 'Updated.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.delete('/:id/sessions/:sessionId/questions/:questionId', requireAuth, async (req, res, next) => {
  try {
    await assertCanModerate(req.user!.id, req.params.id!, req.params.sessionId!)
    await moderateQuestion(req.user!.id, req.params.id!, req.params.sessionId!, req.params.questionId!, 'deleted', auditContextFrom(req))
    res.json({ message: 'Question deleted.' })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Feedback (Audience)
audienceRouter.get('/:id/audience/feedback', requireConferencePermission('audience.give_feedback'), async (req, res, next) => {
  try {
    res.json(await getMyFeedback(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

audienceRouter.put(
  '/:id/audience/feedback',
  requireConferencePermission('audience.give_feedback'),
  validateBody(conferenceFeedbackSchema),
  async (req, res, next) => {
    try {
      const { created } = await saveConferenceFeedback(req.params.id!, req.user!.id, req.body)
      res.status(created ? 201 : 200).json({ message: created ? 'Thank you for your feedback.' : 'Your feedback has been updated.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.put(
  '/:id/audience/sessions/:sessionId/rating',
  requireConferencePermission('audience.give_feedback'),
  validateBody(sessionRatingSchema),
  async (req, res, next) => {
    try {
      const { created } = await saveSessionRating(req.params.id!, req.params.sessionId!, req.user!.id, req.body)
      res.status(created ? 201 : 200).json({ message: created ? 'Thanks for rating this session.' : 'Your rating has been updated.' })
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Feedback (organisers)
// Organisers (audience.moderate) see everything; a chair sees ratings of their own sessions
// only. requireAuth + getFeedbackScope, since it is "a permission OR chair of something".
audienceRouter.get('/:id/audience-feedback', requireAuth, async (req, res, next) => {
  try {
    const scope = await getFeedbackScope(req.user!.id, req.params.id!)
    res.setHeader('Cache-Control', 'no-store')
    res.json(await getFeedbackSummary(req.params.id!, scope, parseFeedbackFilters(req.query as Record<string, unknown>)))
  } catch (err) {
    next(err)
  }
})

audienceRouter.get('/:id/audience-feedback/export.csv', requireAuth, async (req, res, next) => {
  try {
    const scope = await getFeedbackScope(req.user!.id, req.params.id!)
    const summary = await getFeedbackSummary(req.params.id!, scope, parseFeedbackFilters(req.query as Record<string, unknown>))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="audience-feedback.csv"')
    res.setHeader('Cache-Control', 'no-store')
    res.send('\uFEFF' + feedbackCsv(summary))
  } catch (err) {
    next(err)
  }
})

audienceRouter.patch(
  '/:id/audience-feedback/:kind/:itemId',
  requireConferencePermission('audience.moderate'),
  validateBody(moderateFeedbackSchema),
  async (req, res, next) => {
    try {
      const kind = req.params.kind === 'conference' ? 'conference' : req.params.kind === 'session' ? 'session' : null
      if (!kind) throw new NotFoundError('Not found.')
      assertFullScope(await getFeedbackScope(req.user!.id, req.params.id!))
      await moderateFeedback(req.user!.id, req.params.id!, kind, req.params.itemId!, req.body.status, auditContextFrom(req))
      res.json({ message: 'Updated.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.delete('/:id/audience-feedback/:kind/:itemId', requireConferencePermission('audience.moderate'), async (req, res, next) => {
  try {
    const kind = req.params.kind === 'conference' ? 'conference' : req.params.kind === 'session' ? 'session' : null
    if (!kind) throw new NotFoundError('Not found.')
    await moderateFeedback(req.user!.id, req.params.id!, kind, req.params.itemId!, 'deleted', auditContextFrom(req))
    res.json({ message: 'Feedback deleted.' })
  } catch (err) {
    next(err)
  }
})
