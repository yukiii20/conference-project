import { Router } from 'express'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import {
  addPaperPresentation,
  addSpeakerPresentation,
  assertCanManageSessionAttendance,
  assignSessionChair,
  copyScheduleDay,
  createRoom,
  createScheduleSlot,
  createSession,
  deleteScheduleSlot,
  deleteSession,
  getConvenorSchedule,
  getMyPresentations,
  getPublicSchedule,
  getScheduleWarnings,
  getSessionDetail,
  listChairCandidates,
  listRooms,
  listSchedulableSubmissions,
  listScheduleSlots,
  listSessions,
  markPresentation,
  removePresentation,
  removeSessionChair,
  reorderPresentations,
  setRoomStatus,
  updateRoom,
  updateScheduleSlot,
  updateSession,
} from './service.js'
import { generateProgrammePdf, generateSessionIcs } from './export.js'
import { pool } from '../../db/pool.js'
import { NotFoundError } from '../../utils/errors.js'
import {
  addPaperPresentationSchema,
  addSpeakerPresentationSchema,
  copyDaySchema,
  markPresentationSchema,
  reorderPresentationsSchema,
  roomSchema,
  scheduleSlotSchema,
  sessionChairSchema,
  sessionSchema,
  setRoomStatusSchema,
} from './validation.js'

export const scheduleRouter = Router()

// Same short shared cache as the other public, read-only endpoints (see
// conferences/routes.ts) - never applied to anything requiring auth.
const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'

// --------------------------------------------------------------------- Rooms
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

// ------------------------------------------------------------- Schedule slots
scheduleRouter.get('/:id/schedule-slots', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    res.json({ slots: await listScheduleSlots(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

scheduleRouter.post(
  '/:id/schedule-slots',
  requireConferencePermission('schedule.manage'),
  validateBody(scheduleSlotSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await createScheduleSlot(req.user!.id, req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.patch(
  '/:id/schedule-slots/:slotId',
  requireConferencePermission('schedule.manage'),
  validateBody(scheduleSlotSchema),
  async (req, res, next) => {
    try {
      await updateScheduleSlot(req.user!.id, req.params.id!, req.params.slotId!, req.body)
      res.json({ message: 'Slot updated.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.delete(
  '/:id/schedule-slots/:slotId',
  requireConferencePermission('schedule.manage'),
  async (req, res, next) => {
    try {
      await deleteScheduleSlot(req.user!.id, req.params.id!, req.params.slotId!)
      res.json({ message: 'Slot deleted.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.post(
  '/:id/schedule-slots/copy-day',
  requireConferencePermission('schedule.manage'),
  validateBody(copyDaySchema),
  async (req, res, next) => {
    try {
      res.json(await copyScheduleDay(req.user!.id, req.params.id!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Sessions
scheduleRouter.get('/:id/sessions/public', async (req, res, next) => {
  try {
    const schedule = await getPublicSchedule(req.params.id!)
    res.set('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.json({ schedule })
  } catch (err) {
    next(err)
  }
})

scheduleRouter.get('/:id/sessions/public/:sessionId/ics', async (req, res, next) => {
  try {
    const schedule = await getPublicSchedule(req.params.id!)
    const session = schedule.find((s) => s.id === req.params.sessionId)
    if (!session) throw new NotFoundError('This session does not exist.')
    const [confRows] = await pool.query('SELECT name FROM conferences WHERE id = ? LIMIT 1', [req.params.id])
    const conferenceName = (confRows as Array<{ name: string }>)[0]?.name ?? ''
    const ics = generateSessionIcs(session, conferenceName)
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="session.ics"`)
    res.send(ics)
  } catch (err) {
    next(err)
  }
})

scheduleRouter.get('/:id/sessions/public/programme.pdf', async (req, res, next) => {
  try {
    const [confRows] = await pool.query('SELECT name, timezone FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
      req.params.id,
    ])
    const conference = (confRows as Array<{ name: string; timezone: string }>)[0]
    if (!conference) throw new NotFoundError('This conference does not exist.')
    const schedule = await getPublicSchedule(req.params.id!)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="programme.pdf"')
    const doc = generateProgrammePdf(conference.name, conference.timezone, schedule)
    doc.pipe(res)
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

scheduleRouter.get('/:id/sessions/detailed', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    res.json({ sessions: await getConvenorSchedule(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

scheduleRouter.get('/:id/sessions/warnings', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    res.json(await getScheduleWarnings(req.params.id!))
  } catch (err) {
    next(err)
  }
})

scheduleRouter.get(
  '/:id/sessions/schedulable-submissions',
  requireConferencePermission('schedule.manage'),
  async (req, res, next) => {
    try {
      const trackId = typeof req.query.track === 'string' ? req.query.track : undefined
      res.json({ submissions: await listSchedulableSubmissions(req.params.id!, trackId) })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.get('/:id/sessions/chair-candidates', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    res.json({ candidates: await listChairCandidates(req.params.id!) })
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

scheduleRouter.get('/:id/sessions/:sessionId', requireConferencePermission('schedule.manage'), async (req, res, next) => {
  try {
    const session = await getSessionDetail(req.params.id!, req.params.sessionId!)
    if (!session) throw new NotFoundError('This session does not exist.')
    res.json({ session })
  } catch (err) {
    next(err)
  }
})

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

// ----------------------------------------------------------- Session chairs
scheduleRouter.post(
  '/:id/sessions/:sessionId/chairs',
  requireConferencePermission('schedule.manage'),
  validateBody(sessionChairSchema),
  async (req, res, next) => {
    try {
      await assignSessionChair(req.user!.id, req.params.id!, req.params.sessionId!, req.body)
      res.status(201).json({ message: 'Chair assigned.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.delete(
  '/:id/sessions/:sessionId/chairs/:userId',
  requireConferencePermission('schedule.manage'),
  async (req, res, next) => {
    try {
      await removeSessionChair(req.user!.id, req.params.id!, req.params.sessionId!, req.params.userId!)
      res.json({ message: 'Chair removed.' })
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------ Presentations
scheduleRouter.post(
  '/:id/sessions/:sessionId/presentations/papers',
  requireConferencePermission('schedule.manage'),
  validateBody(addPaperPresentationSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await addPaperPresentation(req.user!.id, req.params.id!, req.params.sessionId!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.post(
  '/:id/sessions/:sessionId/presentations/speakers',
  requireConferencePermission('schedule.manage'),
  validateBody(addSpeakerPresentationSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await addSpeakerPresentation(req.user!.id, req.params.id!, req.params.sessionId!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.delete(
  '/:id/sessions/:sessionId/presentations/:presentationId',
  requireConferencePermission('schedule.manage'),
  async (req, res, next) => {
    try {
      await removePresentation(req.user!.id, req.params.id!, req.params.sessionId!, req.params.presentationId!)
      res.json({ message: 'Removed from the programme.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.post(
  '/:id/sessions/:sessionId/presentations/reorder',
  requireConferencePermission('schedule.manage'),
  validateBody(reorderPresentationsSchema),
  async (req, res, next) => {
    try {
      await reorderPresentations(req.user!.id, req.params.id!, req.params.sessionId!, req.body.presentation_ids)
      res.json({ message: 'Reordered.' })
    } catch (err) {
      next(err)
    }
  },
)

// Session chairs mark attendance on their own assigned sessions — not gated by
// schedule.manage, so this uses requireAuth + a per-session check instead of
// requireConferencePermission (which only ever checks the generic permission table).
scheduleRouter.patch(
  '/:id/sessions/:sessionId/presentations/:presentationId/mark',
  requireAuth,
  validateBody(markPresentationSchema),
  async (req, res, next) => {
    try {
      await assertCanManageSessionAttendance(req.user!.id, req.params.id!, req.params.sessionId!)
      await markPresentation(req.user!.id, req.params.id!, req.params.presentationId!, req.body.status)
      res.json({ message: 'Updated.' })
    } catch (err) {
      next(err)
    }
  },
)

scheduleRouter.get('/:id/sessions/:sessionId/chair-view', requireAuth, async (req, res, next) => {
  try {
    await assertCanManageSessionAttendance(req.user!.id, req.params.id!, req.params.sessionId!)
    const session = await getSessionDetail(req.params.id!, req.params.sessionId!)
    if (!session) throw new NotFoundError('This session does not exist.')
    res.json({ session })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------- Personal views
scheduleRouter.get('/:id/my-presentations', requireAuth, async (req, res, next) => {
  try {
    res.json({ presentations: await getMyPresentations(req.params.id!, req.user!.id) })
  } catch (err) {
    next(err)
  }
})
