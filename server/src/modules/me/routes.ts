import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { uploadRateLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { buildPublicPath, deletePublicFile, savePublicFile } from '../../storage/fileStore.js'
import { imageUpload, processImage } from '../../storage/imageUpload.js'
import { BadRequestError } from '../../utils/errors.js'
import {
  getMyProfile,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeMyPhoto,
  setMyPhoto,
  updateMyProfile,
} from './service.js'
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

meRouter.post('/photo', requireAuth, uploadRateLimit, imageUpload(PHOTO_MAX_BYTES), async (req, res, next) => {
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

meRouter.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true'
    res.json({ notifications: await listMyNotifications(req.user!.id, unreadOnly) })
  } catch (err) {
    next(err)
  }
})

meRouter.post('/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    await markNotificationRead(req.user!.id, req.params.id!)
    res.json({ message: 'Marked read.' })
  } catch (err) {
    next(err)
  }
})

meRouter.post('/notifications/read-all', requireAuth, async (req, res, next) => {
  try {
    await markAllNotificationsRead(req.user!.id)
    res.json({ message: 'All notifications marked read.' })
  } catch (err) {
    next(err)
  }
})
