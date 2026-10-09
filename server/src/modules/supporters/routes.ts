import { Router } from 'express'
import { z } from 'zod'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { buildPublicPath, deletePublicFile, savePublicFile } from '../../storage/fileStore.js'
import { imageUpload, processImage } from '../../storage/imageUpload.js'
import { BadRequestError } from '../../utils/errors.js'
import {
  createSupporter,
  deleteSupporter,
  listSupporters,
  reorderSupporters,
  setSupporterActive,
  setSupporterLogoPath,
  updateSupporter,
} from './service.js'
import { createSupporterSchema, reorderSupportersSchema, updateSupporterSchema } from './validation.js'

const LOGO_MAX_BYTES = 2 * 1024 * 1024

export const supportersRouter = Router()

const setActiveSchema = z.object({ is_active: z.boolean() })

supportersRouter.get('/:id/supporters', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    const supporters = await listSupporters(req.params.id!)
    res.json({ supporters })
  } catch (err) {
    next(err)
  }
})

supportersRouter.post(
  '/:id/supporters',
  requireConferencePermission('conference.manage'),
  validateBody(createSupporterSchema),
  async (req, res, next) => {
    try {
      const result = await createSupporter(req.user!.id, req.params.id!, req.body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  },
)

supportersRouter.post(
  '/:id/supporters/reorder',
  requireConferencePermission('conference.manage'),
  validateBody(reorderSupportersSchema),
  async (req, res, next) => {
    try {
      await reorderSupporters(req.user!.id, req.params.id!, req.body.tier, req.body.supporter_ids)
      res.json({ message: 'Supporters reordered.' })
    } catch (err) {
      next(err)
    }
  },
)

supportersRouter.patch(
  '/:id/supporters/:supporterId',
  requireConferencePermission('conference.manage'),
  validateBody(updateSupporterSchema),
  async (req, res, next) => {
    try {
      await updateSupporter(req.user!.id, req.params.id!, req.params.supporterId!, req.body)
      res.json({ message: 'Supporter updated.' })
    } catch (err) {
      next(err)
    }
  },
)

supportersRouter.patch(
  '/:id/supporters/:supporterId/active',
  requireConferencePermission('conference.manage'),
  validateBody(setActiveSchema),
  async (req, res, next) => {
    try {
      await setSupporterActive(req.user!.id, req.params.id!, req.params.supporterId!, req.body.is_active)
      res.json({ message: 'Supporter updated.' })
    } catch (err) {
      next(err)
    }
  },
)

supportersRouter.delete(
  '/:id/supporters/:supporterId',
  requireConferencePermission('conference.manage'),
  async (req, res, next) => {
    try {
      const { logoPath } = await deleteSupporter(req.user!.id, req.params.id!, req.params.supporterId!)
      await deletePublicFile(logoPath)
      res.json({ message: 'Supporter deleted.' })
    } catch (err) {
      next(err)
    }
  },
)

supportersRouter.post(
  '/:id/supporters/:supporterId/logo',
  requireConferencePermission('conference.manage'),
  imageUpload(LOGO_MAX_BYTES),
  async (req, res, next) => {
    try {
      if (!req.file) throw new BadRequestError('Choose an image to upload.')
      const processed = await processImage(req.file.buffer)
      const relativePath = buildPublicPath(`conferences/${req.params.id}/supporters`, processed.ext)
      await savePublicFile(relativePath, processed.buffer)
      const previousPath = await setSupporterLogoPath(req.user!.id, req.params.id!, req.params.supporterId!, relativePath)
      await deletePublicFile(previousPath)
      res.json({ path: relativePath })
    } catch (err) {
      next(err)
    }
  },
)

supportersRouter.delete(
  '/:id/supporters/:supporterId/logo',
  requireConferencePermission('conference.manage'),
  async (req, res, next) => {
    try {
      const previousPath = await setSupporterLogoPath(req.user!.id, req.params.id!, req.params.supporterId!, null)
      await deletePublicFile(previousPath)
      res.json({ message: 'Removed.' })
    } catch (err) {
      next(err)
    }
  },
)
