import { Router } from 'express'
import { pool } from '../../db/pool.js'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  publishAnnouncementNow,
  updateAnnouncement,
} from './service.js'
import { createAnnouncementSchema, updateAnnouncementSchema } from './validation.js'

export const announcementsRouter = Router()
export const announcementsConferenceRouter = Router()
const PERM = 'announcement.manage'

announcementsConferenceRouter.get('/:id/announcements', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json({ announcements: await listAnnouncements(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

announcementsConferenceRouter.post(
  '/:id/announcements',
  requireConferencePermission(PERM),
  validateBody(createAnnouncementSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await createAnnouncement(req.user!.id, req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

announcementsConferenceRouter.patch(
  '/:id/announcements/:announcementId',
  requireConferencePermission(PERM),
  validateBody(updateAnnouncementSchema),
  async (req, res, next) => {
    try {
      await updateAnnouncement(req.user!.id, req.params.id!, req.params.announcementId!, req.body)
      res.json({ message: 'Announcement updated.' })
    } catch (err) {
      next(err)
    }
  },
)

announcementsConferenceRouter.post(
  '/:id/announcements/:announcementId/publish',
  requireConferencePermission(PERM),
  async (req, res, next) => {
    try {
      await publishAnnouncementNow(req.user!.id, req.params.id!, req.params.announcementId!)
      res.json({ message: 'Announcement published.' })
    } catch (err) {
      next(err)
    }
  },
)

announcementsConferenceRouter.post(
  '/:id/announcements/:announcementId/archive',
  requireConferencePermission(PERM),
  async (req, res, next) => {
    try {
      await archiveAnnouncement(req.user!.id, req.params.id!, req.params.announcementId!)
      res.json({ message: 'Announcement archived.' })
    } catch (err) {
      next(err)
    }
  },
)

announcementsConferenceRouter.delete(
  '/:id/announcements/:announcementId',
  requireConferencePermission(PERM),
  async (req, res, next) => {
    try {
      await deleteAnnouncement(req.user!.id, req.params.id!, req.params.announcementId!)
      res.json({ message: 'Announcement deleted.' })
    } catch (err) {
      next(err)
    }
  },
)

const DEFAULT_LIMIT = 3
const MAX_LIMIT = 20

announcementsRouter.get('/public', async (req, res, next) => {
  try {
    const requested = Number(req.query.limit)
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT

    const [rows] = await pool.query(
      `SELECT a.id, a.title, a.body, a.publish_at, a.created_at,
              c.name AS conference_name, c.slug AS conference_slug
       FROM announcements a
       JOIN conferences c ON c.id = a.conference_id
       WHERE a.status = 'published'
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [limit],
    )
    res.json({ announcements: rows })
  } catch (err) {
    next(err)
  }
})
