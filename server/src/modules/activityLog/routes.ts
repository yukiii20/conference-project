import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { listActivityLog } from './service.js'
import { activityLogQuerySchema } from './validation.js'

export const activityLogRouter = Router()

activityLogRouter.get(
  '/:id/activity-log',
  requireConferencePermission('audit.read'),
  validateQuery(activityLogQuerySchema),
  async (req, res, next) => {
    try {
      res.json(await listActivityLog(req.params.id!, req.query as never))
    } catch (err) {
      next(err)
    }
  },
)
