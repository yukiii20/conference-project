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
