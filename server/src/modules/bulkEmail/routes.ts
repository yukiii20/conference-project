import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import {
  createDraft,
  deleteDraft,
  getBulkEmailDetail,
  listBulkEmails,
  previewContent,
  previewRecipients,
  sendBulkEmail,
  sendTestEmail,
  updateDraft,
} from './service.js'
import { previewContentSchema, previewRecipientsSchema, saveDraftSchema } from './validation.js'

export const bulkEmailRouter = Router()
const PERM = 'communication.bulk_email'

bulkEmailRouter.get('/:id/bulk-email', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json({ bulk_emails: await listBulkEmails(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

bulkEmailRouter.get('/:id/bulk-email/:bulkEmailId', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json(await getBulkEmailDetail(req.params.id!, req.params.bulkEmailId!))
  } catch (err) {
    next(err)
  }
})

bulkEmailRouter.post(
  '/:id/bulk-email/recipients-preview',
  requireConferencePermission(PERM),
  validateBody(previewRecipientsSchema),
  async (req, res, next) => {
    try {
      res.json(await previewRecipients(req.params.id!, req.body.groups))
    } catch (err) {
      next(err)
    }
  },
)

bulkEmailRouter.post(
  '/:id/bulk-email/content-preview',
  requireConferencePermission(PERM),
  validateBody(previewContentSchema),
  async (req, res, next) => {
    try {
      res.json(await previewContent(req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

bulkEmailRouter.post(
  '/:id/bulk-email',
  requireConferencePermission(PERM),
  validateBody(saveDraftSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await createDraft(req.user!.id, req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

bulkEmailRouter.patch(
  '/:id/bulk-email/:bulkEmailId',
  requireConferencePermission(PERM),
  validateBody(saveDraftSchema),
  async (req, res, next) => {
    try {
      await updateDraft(req.user!.id, req.params.id!, req.params.bulkEmailId!, req.body)
      res.json({ message: 'Draft saved.' })
    } catch (err) {
      next(err)
    }
  },
)

bulkEmailRouter.delete('/:id/bulk-email/:bulkEmailId', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    await deleteDraft(req.user!.id, req.params.id!, req.params.bulkEmailId!)
    res.json({ message: 'Draft deleted.' })
  } catch (err) {
    next(err)
  }
})

bulkEmailRouter.post('/:id/bulk-email/:bulkEmailId/test', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    await sendTestEmail(req.user!.id, req.params.id!, req.params.bulkEmailId!)
    res.json({ message: 'Test email queued — check your inbox shortly.' })
  } catch (err) {
    next(err)
  }
})

bulkEmailRouter.post('/:id/bulk-email/:bulkEmailId/send', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json(await sendBulkEmail(req.user!.id, req.params.id!, req.params.bulkEmailId!))
  } catch (err) {
    next(err)
  }
})
