import { Router } from 'express'
import { z } from 'zod'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { createTrack, listTracks, reorderTracks, setTrackActive, updateTrack } from './service.js'
import { createTrackSchema, reorderTracksSchema, updateTrackSchema } from './validation.js'

export const tracksRouter = Router()

const setActiveSchema = z.object({ is_active: z.boolean() })

tracksRouter.get('/:id/tracks', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    const tracks = await listTracks(req.params.id!)
    res.json({ tracks })
  } catch (err) {
    next(err)
  }
})

tracksRouter.post(
  '/:id/tracks',
  requireConferencePermission('conference.manage'),
  validateBody(createTrackSchema),
  async (req, res, next) => {
    try {
      const result = await createTrack(req.user!.id, req.params.id!, req.body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  },
)

tracksRouter.post(
  '/:id/tracks/reorder',
  requireConferencePermission('conference.manage'),
  validateBody(reorderTracksSchema),
  async (req, res, next) => {
    try {
      await reorderTracks(req.user!.id, req.params.id!, req.body.track_ids)
      res.json({ message: 'Tracks reordered.' })
    } catch (err) {
      next(err)
    }
  },
)

tracksRouter.patch(
  '/:id/tracks/:trackId',
  requireConferencePermission('conference.manage'),
  validateBody(updateTrackSchema),
  async (req, res, next) => {
    try {
      await updateTrack(req.user!.id, req.params.id!, req.params.trackId!, req.body)
      res.json({ message: 'Track updated.' })
    } catch (err) {
      next(err)
    }
  },
)

tracksRouter.patch(
  '/:id/tracks/:trackId/deactivate',
  requireConferencePermission('conference.manage'),
  validateBody(setActiveSchema),
  async (req, res, next) => {
    try {
      await setTrackActive(req.user!.id, req.params.id!, req.params.trackId!, req.body.is_active)
      res.json({ message: 'Track updated.' })
    } catch (err) {
      next(err)
    }
  },
)
