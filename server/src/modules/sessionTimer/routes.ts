import { Router } from 'express'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { auditContextFrom } from '../../utils/audit.js'
import { assertCanManageSessionAttendance } from '../schedule/service.js'
import { getTimerData, getTimerDefaults, updateSessionTiming, updateTimerDefaults } from './service.js'
import { sessionTimingSchema, timerDefaultsSchema } from './validation.js'

export const sessionTimerRouter = Router()

// The session's own chairs and anyone with schedule.manage (the convenor) can
// open the timer — same per-session check as marking presented/absent.
sessionTimerRouter.get('/:id/sessions/:sessionId/timer', requireAuth, async (req, res, next) => {
  try {
    await assertCanManageSessionAttendance(req.user!.id, req.params.id!, req.params.sessionId!)
    res.json(await getTimerData(req.params.id!, req.params.sessionId!))
  } catch (err) {
    next(err)
  }
})

sessionTimerRouter.get('/:id/timer-defaults', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    res.json(await getTimerDefaults(req.params.id!))
  } catch (err) {
    next(err)
  }
})

sessionTimerRouter.put(
  '/:id/timer-defaults',
  requireConferencePermission('schedule.manage'),
  validateBody(timerDefaultsSchema),
  async (req, res, next) => {
    try {
      res.json(await updateTimerDefaults(req.user!.id, req.params.id!, req.body, auditContextFrom(req)))
    } catch (err) {
      next(err)
    }
  },
)

sessionTimerRouter.put(
  '/:id/sessions/:sessionId/timer-settings',
  requireConferencePermission('schedule.manage'),
  validateBody(sessionTimingSchema),
  async (req, res, next) => {
    try {
      await updateSessionTiming(req.user!.id, req.params.id!, req.params.sessionId!, req.body, auditContextFrom(req))
      res.json({ message: 'Saved.' })
    } catch (err) {
      next(err)
    }
  },
)
