import { Router } from 'express'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'
import { auditContextFrom } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
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
