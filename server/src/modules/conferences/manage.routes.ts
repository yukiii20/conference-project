import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { buildPublicPath, deletePublicFile, savePublicFile } from '../../storage/fileStore.js'
import { imageUpload, processImage } from '../../storage/imageUpload.js'
import { BadRequestError } from '../../utils/errors.js'
import { getConferenceForManagement, setConferenceImagePath, updateConference } from './manage.service.js'
import { updateConferenceSchema } from './manage.validation.js'

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const BANNER_MAX_BYTES = 3 * 1024 * 1024

export const conferencesManageRouter = Router()

// `/details` (not `/:id`) deliberately avoids colliding with the Phase 1
// public router's `GET /:slug`, which is mounted first and would otherwise
// always win the match for a single path segment.
conferencesManageRouter.get('/:id/details', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    res.json({ conference: await getConferenceForManagement(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

conferencesManageRouter.patch(
  '/:id',
  requireConferencePermission('conference.manage'),
  validateBody(updateConferenceSchema),
  async (req, res, next) => {
    try {
      await updateConference(req.user!.id, req.params.id!, req.body)
      res.json({ message: 'Conference updated.' })
    } catch (err) {
      next(err)
    }
  },
)

function imageRoutes(column: 'logo_path' | 'banner_path', urlSegment: string, maxBytes: number) {
  conferencesManageRouter.post(
    `/:id/${urlSegment}`,
    requireConferencePermission('conference.manage'),
    imageUpload(maxBytes),
    async (req, res, next) => {
      try {
        if (!req.file) throw new BadRequestError('Choose an image to upload.')
        const processed = await processImage(req.file.buffer)
        const relativePath = buildPublicPath(`conferences/${req.params.id}`, processed.ext)
        await savePublicFile(relativePath, processed.buffer)
        const previousPath = await setConferenceImagePath(req.user!.id, req.params.id!, column, relativePath)
        await deletePublicFile(previousPath)
        res.json({ path: relativePath })
      } catch (err) {
        next(err)
      }
    },
  )

  conferencesManageRouter.delete(
    `/:id/${urlSegment}`,
    requireConferencePermission('conference.manage'),
    async (req, res, next) => {
      try {
        const previousPath = await setConferenceImagePath(req.user!.id, req.params.id!, column, null)
        await deletePublicFile(previousPath)
        res.json({ message: 'Removed.' })
      } catch (err) {
        next(err)
      }
    },
  )
}

imageRoutes('logo_path', 'logo', LOGO_MAX_BYTES)
imageRoutes('banner_path', 'banner', BANNER_MAX_BYTES)
