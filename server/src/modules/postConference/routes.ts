import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { emailTriggerRateLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { saveDraftSchema } from '../bulkEmail/validation.js'
import { getPostConferenceState, sendPostConferenceEmail } from './service.js'

/** changes-nov2, Part 5: Communication -> Post-conference email. Mounted under /api/conferences. */
export const postConferenceRouter = Router()
const PERM = 'communication.bulk_email'

postConferenceRouter.get('/:id/post-conference-email', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json(await getPostConferenceState(req.params.id!))
  } catch (err) {
    next(err)
  }
})

postConferenceRouter.post(
  '/:id/post-conference-email/send',
  requireConferencePermission(PERM),
  emailTriggerRateLimit,
  validateBody(saveDraftSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await sendPostConferenceEmail(req.user!.id, req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)
