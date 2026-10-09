import { Router } from 'express'
import { requireConferenceRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { getSettings, updateSettings } from './service.js'
import { updateSettingsSchema } from './validation.js'

export const settingsRouter = Router()

// Convenor-or-admin only, per the spec — deliberately not `conference.manage`,
// which `manager` also holds (requireConferenceRole has a built-in admin bypass).
settingsRouter.get('/:id/settings', requireConferenceRole(['convenor']), async (req, res, next) => {
  try {
    res.json({ settings: await getSettings(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

settingsRouter.patch(
  '/:id/settings',
  requireConferenceRole(['convenor']),
  validateBody(updateSettingsSchema),
  async (req, res, next) => {
    try {
      await updateSettings(req.user!.id, req.params.id!, req.body)
      res.json({ message: 'Settings saved.' })
    } catch (err) {
      next(err)
    }
  },
)
