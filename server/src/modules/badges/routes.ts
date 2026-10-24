import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { generateBadgeSheet, generateSingleBadge, listBadgeCandidates } from './service.js'
import { badgeFilterQuerySchema } from './validation.js'

export const badgesRouter = Router()
const PERM = 'attendance.record'

badgesRouter.get(
  '/:id/registrations/badges',
  requireConferencePermission(PERM),
  validateQuery(badgeFilterQuerySchema),
  async (req, res, next) => {
    try {
      res.json({ candidates: await listBadgeCandidates(req.params.id!, req.query as never) })
    } catch (err) {
      next(err)
    }
  },
)

badgesRouter.get(
  '/:id/registrations/badges.pdf',
  requireConferencePermission(PERM),
  validateQuery(badgeFilterQuerySchema),
  async (req, res, next) => {
    try {
      const pdf = await generateBadgeSheet(req.user!.id, req.params.id!, req.query as never)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', 'attachment; filename="badges.pdf"')
      res.send(pdf)
    } catch (err) {
      next(err)
    }
  },
)

badgesRouter.get(
  '/:id/registrations/:registrationId/badge.pdf',
  requireConferencePermission(PERM),
  async (req, res, next) => {
    try {
      const pdf = await generateSingleBadge(req.user!.id, req.params.id!, req.params.registrationId!)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', 'attachment; filename="badge.pdf"')
      res.send(pdf)
    } catch (err) {
      next(err)
    }
  },
)
