import { Router } from 'express'
import { requireAdmin, requireAuth } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { listEmailLogForAdmin, listEmailLogForConference, retryEmailAsAdmin, retryEmailForConference } from './service.js'
import { listEmailLogQuerySchema } from './validation.js'

export const adminEmailsRouter = Router()

adminEmailsRouter.get('/email-log', requireAdmin, validateQuery(listEmailLogQuerySchema), async (req, res, next) => {
  try {
    res.json(await listEmailLogForAdmin(req.query as never))
  } catch (err) {
    next(err)
  }
})

adminEmailsRouter.post('/email-log/:id/retry', requireAdmin, async (req, res, next) => {
  try {
    await retryEmailAsAdmin(Number(req.params.id))
    res.json({ message: 'Email queued for another attempt.' })
  } catch (err) {
    next(err)
  }
})

export const emailsConferenceRouter = Router()

emailsConferenceRouter.get(
  '/:id/email-log',
  requireAuth,
  validateQuery(listEmailLogQuerySchema),
  async (req, res, next) => {
    try {
      res.json(await listEmailLogForConference(req.user!.id, req.params.id!, req.query as never))
    } catch (err) {
      next(err)
    }
  },
)

emailsConferenceRouter.post('/:id/email-log/:logId/retry', requireAuth, async (req, res, next) => {
  try {
    await retryEmailForConference(req.user!.id, req.params.id!, Number(req.params.logId))
    res.json({ message: 'Email queued for another attempt.' })
  } catch (err) {
    next(err)
  }
})
