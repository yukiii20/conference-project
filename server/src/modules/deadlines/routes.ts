import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { listDeadlines, updateDeadlines } from './service.js'
import { updateDeadlinesSchema } from './validation.js'

export const deadlinesRouter = Router()

deadlinesRouter.get('/:id/deadlines', requireConferencePermission('deadline.manage'), async (req, res, next) => {
  try {
    const deadlines = await listDeadlines(req.params.id!)
    res.json({ deadlines })
  } catch (err) {
    next(err)
  }
})

deadlinesRouter.put(
  '/:id/deadlines',
  requireConferencePermission('deadline.manage'),
  validateBody(updateDeadlinesSchema),
  async (req, res, next) => {
    try {
      await updateDeadlines(req.user!.id, req.params.id!, req.body)
      res.json({ message: 'Key dates saved.' })
    } catch (err) {
      next(err)
    }
  },
)
