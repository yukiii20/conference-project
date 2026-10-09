import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { listEmailTemplates, previewEmailTemplate, resetEmailTemplate, saveEmailTemplate } from './service.js'
import { saveEmailTemplateSchema } from './validation.js'

export const emailTemplatesRouter = Router()
const PERM = 'conference.manage'

emailTemplatesRouter.get('/:id/email-templates', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json({ templates: await listEmailTemplates(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

emailTemplatesRouter.get(
  '/:id/email-templates/:templateKey/preview',
  requireConferencePermission(PERM),
  async (req, res, next) => {
    try {
      res.json(await previewEmailTemplate(req.params.id!, req.params.templateKey!))
    } catch (err) {
      next(err)
    }
  },
)

emailTemplatesRouter.post(
  '/:id/email-templates/:templateKey',
  requireConferencePermission(PERM),
  validateBody(saveEmailTemplateSchema),
  async (req, res, next) => {
    try {
      await saveEmailTemplate(req.user!.id, req.params.id!, req.params.templateKey!, req.body)
      res.json({ message: 'Template saved.' })
    } catch (err) {
      next(err)
    }
  },
)

emailTemplatesRouter.post(
  '/:id/email-templates/:templateKey/reset',
  requireConferencePermission(PERM),
  async (req, res, next) => {
    try {
      await resetEmailTemplate(req.user!.id, req.params.id!, req.params.templateKey!)
      res.json({ message: 'Reset to the platform default.' })
    } catch (err) {
      next(err)
    }
  },
)
