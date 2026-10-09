import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import {
  createRoom,
  createSession,
  deleteSession,
  getPublicSchedule,
  listRooms,
  listSessions,
  setRoomStatus,
  updateRoom,
  updateSession,
} from './service.js'
import { roomSchema, sessionSchema, setRoomStatusSchema } from './validation.js'

export const scheduleRouter = Router()

scheduleRouter.get('/:id/rooms', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    res.json({ rooms: await listRooms(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

scheduleRouter.post(
  '/:id/rooms',
  requireConferencePermission('schedule.manage'),
  validateBody(roomSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await createRoom(req.user!.id, req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.patch(
  '/:id/rooms/:roomId',
  requireConferencePermission('schedule.manage'),
  validateBody(roomSchema),
  async (req, res, next) => {
    try {
      await updateRoom(req.user!.id, req.params.id!, req.params.roomId!, req.body)
      res.json({ message: 'Room updated.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.patch(
  '/:id/rooms/:roomId/status',
  requireConferencePermission('schedule.manage'),
  validateBody(setRoomStatusSchema),
  async (req, res, next) => {
    try {
      await setRoomStatus(req.user!.id, req.params.id!, req.params.roomId!, req.body.status)
      res.json({ message: 'Room updated.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.get('/:id/sessions/public', async (req, res, next) => {
  try {
    res.json({ schedule: await getPublicSchedule(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

scheduleRouter.get('/:id/sessions', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    res.json({ sessions: await listSessions(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

scheduleRouter.post(
  '/:id/sessions',
  requireConferencePermission('schedule.manage'),
  validateBody(sessionSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await createSession(req.user!.id, req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.patch(
  '/:id/sessions/:sessionId',
  requireConferencePermission('schedule.manage'),
  validateBody(sessionSchema),
  async (req, res, next) => {
    try {
      await updateSession(req.user!.id, req.params.id!, req.params.sessionId!, req.body)
      res.json({ message: 'Session updated.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.delete(
  '/:id/sessions/:sessionId',
  requireConferencePermission('schedule.manage'),
  async (req, res, next) => {
    try {
      await deleteSession(req.user!.id, req.params.id!, req.params.sessionId!)
      res.json({ message: 'Session deleted.' })
    } catch (err) {
      next(err)
    }
  },
)
