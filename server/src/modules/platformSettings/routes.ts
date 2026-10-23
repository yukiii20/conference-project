import { Router } from 'express'
import { requireAdmin } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { auditContextFrom } from '../../utils/audit.js'
import { getPlatformSettings, updatePlatformSettings } from './service.js'
import { platformSettingsSchema } from './validation.js'

/** No auth: the public home page and footer read these. */
export const platformSettingsPublicRouter = Router()

platformSettingsPublicRouter.get('/platform-settings', async (_req, res, next) => {
  try {
    const settings = await getPlatformSettings()
    // Same short shared cache as the other public, read-only endpoints (see
    // conferences/routes.ts) - never applied to the admin router above, which
    // requires auth.
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    res.json({ settings })
  } catch (err) {
    next(err)
  }
})

export const platformSettingsAdminRouter = Router()

platformSettingsAdminRouter.get('/platform-settings', requireAdmin, async (_req, res, next) => {
  try {
    res.json({ settings: await getPlatformSettings() })
  } catch (err) {
    next(err)
  }
})

platformSettingsAdminRouter.patch(
  '/platform-settings',
  requireAdmin,
  validateBody(platformSettingsSchema),
  async (req, res, next) => {
    try {
      const settings = await updatePlatformSettings(req.user!.id, req.body, auditContextFrom(req))
      res.json({ settings })
    } catch (err) {
      next(err)
    }
  },
)
