import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { uploadRateLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { buildPublicPath, deletePublicFile, savePublicFile } from '../../storage/fileStore.js'
import { imageUpload, processImage } from '../../storage/imageUpload.js'
import { BadRequestError } from '../../utils/errors.js'
import { createSpeaker, deleteSpeaker, listSpeakers, reorderSpeakers, setSpeakerPhotoPath, updateSpeaker } from './service.js'
import { createSpeakerSchema, reorderSpeakersSchema, updateSpeakerSchema } from './validation.js'

const PHOTO_MAX_BYTES = 2 * 1024 * 1024
const PERM = 'conference.manage'

export const speakersRouter = Router()

speakersRouter.get('/:id/speakers', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json({ speakers: await listSpeakers(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

speakersRouter.post('/:id/speakers', requireConferencePermission(PERM), validateBody(createSpeakerSchema), async (req, res, next) => {
  try {
    res.status(201).json(await createSpeaker(req.user!.id, req.params.id!, req.body))
  } catch (err) {
    next(err)
  }
})

speakersRouter.post(
  '/:id/speakers/reorder',
  requireConferencePermission(PERM),
  validateBody(reorderSpeakersSchema),
  async (req, res, next) => {
    try {
      await reorderSpeakers(req.user!.id, req.params.id!, req.body.speaker_ids)
      res.json({ message: 'Speakers reordered.' })
    } catch (err) {
      next(err)
    }
  },
)

speakersRouter.patch(
  '/:id/speakers/:speakerId',
  requireConferencePermission(PERM),
  validateBody(updateSpeakerSchema),
  async (req, res, next) => {
    try {
      await updateSpeaker(req.user!.id, req.params.id!, req.params.speakerId!, req.body)
      res.json({ message: 'Speaker updated.' })
    } catch (err) {
      next(err)
    }
  },
)

speakersRouter.delete('/:id/speakers/:speakerId', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    const { photoPath } = await deleteSpeaker(req.user!.id, req.params.id!, req.params.speakerId!)
    await deletePublicFile(photoPath)
    res.json({ message: 'Speaker deleted.' })
  } catch (err) {
    next(err)
  }
})

speakersRouter.post(
  '/:id/speakers/:speakerId/photo',
  requireConferencePermission(PERM),
  uploadRateLimit,
  imageUpload(PHOTO_MAX_BYTES),
  async (req, res, next) => {
    try {
      if (!req.file) throw new BadRequestError('Choose an image to upload.')
      const processed = await processImage(req.file.buffer, { square: 400 })
      const relativePath = buildPublicPath(`conferences/${req.params.id}/speakers`, processed.ext)
      await savePublicFile(relativePath, processed.buffer)
      const previousPath = await setSpeakerPhotoPath(req.user!.id, req.params.id!, req.params.speakerId!, relativePath)
      await deletePublicFile(previousPath)
      res.json({ path: relativePath })
    } catch (err) {
      next(err)
    }
  },
)

speakersRouter.delete('/:id/speakers/:speakerId/photo', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    const previousPath = await setSpeakerPhotoPath(req.user!.id, req.params.id!, req.params.speakerId!, null)
    await deletePublicFile(previousPath)
    res.json({ message: 'Removed.' })
  } catch (err) {
    next(err)
  }
})
