import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { getDashboard } from './service.js'

export const dashboardRouter = Router()

dashboardRouter.get('/:id/dashboard', requireConferencePermission('conference.view_internal'), async (req, res, next) => {
  try {
    res.json(await getDashboard(req.params.id!))
  } catch (err) {
    next(err)
  }
})
