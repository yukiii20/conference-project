import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { buildPublicPath, deletePublicFile, savePublicFile } from '../../storage/fileStore.js'
import { imageUpload, processImage } from '../../storage/imageUpload.js'
import { BadRequestError } from '../../utils/errors.js'
import { getMyProfile, removeMyPhoto, setMyPhoto, updateMyProfile } from './service.js'
import { updateMyProfileSchema } from './validation.js'

const PHOTO_MAX_BYTES = 5 * 1024 * 1024
const PHOTO_SIZE = 512

export const meRouter = Router()

meRouter.get('/profile', requireAuth, async (req, res, next) => {
  try {
    res.json({ user: await getMyProfile(req.user!.id) })
  } catch (err) {
    next(err)
  }
})

meRouter.patch('/profile', requireAuth, validateBody(updateMyProfileSchema), async (req, res, next) => {
  try {
    await updateMyProfile(req.user!.id, req.body)
    res.json({ user: await getMyProfile(req.user!.id) })
  } catch (err) {
    next(err)
  }
})

meRouter.post('/photo', requireAuth, imageUpload(PHOTO_MAX_BYTES), async (req, res, next) => {
  try {
    if (!req.file) throw new BadRequestError('Choose an image to upload.')
    const processed = await processImage(req.file.buffer, { square: PHOTO_SIZE })
    const relativePath = buildPublicPath(`avatars/${req.user!.id}`, processed.ext)
    await savePublicFile(relativePath, processed.buffer)
    const previousPath = await setMyPhoto(req.user!.id, relativePath)
    await deletePublicFile(previousPath)
    res.json({ path: relativePath })
  } catch (err) {
    next(err)
  }
})

meRouter.delete('/photo', requireAuth, async (req, res, next) => {
  try {
    const previousPath = await removeMyPhoto(req.user!.id)
    await deletePublicFile(previousPath)
    res.json({ message: 'Removed.' })
  } catch (err) {
    next(err)
  }
})
