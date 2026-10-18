import { Router } from 'express'
import QRCode from 'qrcode'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { auditContextFrom } from '../../utils/audit.js'
import { env } from '../../config/env.js'
import { NotFoundError } from '../../utils/errors.js'
import {
  adminCancelRegistration,
  assertCanRecordSessionAttendance,
  assertCanSearchRegistrations,
  cancelMyRegistration,
  checkinByQrToken,
  checkinByRegistrationId,
  checkout,
  confirmRegistration,
  createCategory,
  exportRegistrationsCsv,
  getAttendanceDashboard,
  getMyRegistration,
  getMyRegistrationQrToken,
  listCategories,
  listRecentCheckins,
  listRegistrations,
  register,
  searchRegistrations,
  sessionCheckinByQrToken,
  sessionCheckinByRegistrationId,
  updateCategory,
} from './service.js'
import {
  checkinSchema,
  manualCheckinSchema,
  manualSessionCheckinSchema,
  registerSchema,
  registrationCategorySchema,
  sessionCheckinSchema,
} from './validation.js'

export const registrationRouter = Router()

// ------------------------------------------------------------- Categories
registrationRouter.get('/:id/registration-categories', requireAuth, async (req, res, next) => {
  try {
    res.json({ categories: await listCategories(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

registrationRouter.post(
  '/:id/registration-categories',
  requireConferencePermission('registration.manage'),
  validateBody(registrationCategorySchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await createCategory(req.user!.id, req.params.id!, req.body, auditContextFrom(req)))
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.patch(
  '/:id/registration-categories/:categoryId',
  requireConferencePermission('registration.manage'),
  validateBody(registrationCategorySchema),
  async (req, res, next) => {
    try {
      await updateCategory(req.user!.id, req.params.id!, req.params.categoryId!, req.body, auditContextFrom(req))
      res.json({ message: 'Category updated.' })
    } catch (err) {
      next(err)
    }
  },
)

// --------------------------------------------------------- My registration
registrationRouter.get('/:id/my-registration', requireAuth, async (req, res, next) => {
  try {
    res.json({ registration: await getMyRegistration(req.params.id!, req.user!.id) })
  } catch (err) {
    next(err)
  }
})

registrationRouter.get('/:id/my-registration/qr.png', requireAuth, async (req, res, next) => {
  try {
    const qrToken = await getMyRegistrationQrToken(req.params.id!, req.user!.id)
    if (!qrToken) throw new NotFoundError('You do not have an active registration for this conference.')
    const buffer = await QRCode.toBuffer(`${env.APP_URL}/checkin/${qrToken}`, { type: 'png', width: 320, margin: 2 })
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

registrationRouter.post(
  '/:id/register',
  requireAuth,
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await register(req.params.id!, req.user!.id, req.body.category_id, auditContextFrom(req)))
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.delete('/:id/my-registration', requireAuth, async (req, res, next) => {
  try {
    await cancelMyRegistration(req.params.id!, req.user!.id, auditContextFrom(req))
    res.json({ message: 'Registration cancelled.' })
  } catch (err) {
    next(err)
  }
})

// ----------------------------------------------------- Convenor/manager
registrationRouter.get('/:id/registrations', requireConferencePermission('registration.read_all'), async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id : undefined
    const pageNum = Number(req.query.page)
    const page = Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1
    res.json(await listRegistrations(req.params.id!, { search, status, categoryId, page }))
  } catch (err) {
    next(err)
  }
})

registrationRouter.get(
  '/:id/registrations/export.csv',
  requireConferencePermission('registration.read_all'),
  async (req, res, next) => {
    try {
      const csv = await exportRegistrationsCsv(req.params.id!)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"')
      res.send(csv)
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.patch(
  '/:id/registrations/:registrationId/confirm',
  requireConferencePermission('registration.manage'),
  async (req, res, next) => {
    try {
      await confirmRegistration(req.user!.id, req.params.id!, req.params.registrationId!, auditContextFrom(req))
      res.json({ message: 'Registration confirmed.' })
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.delete(
  '/:id/registrations/:registrationId',
  requireConferencePermission('registration.manage'),
  async (req, res, next) => {
    try {
      await adminCancelRegistration(req.user!.id, req.params.id!, req.params.registrationId!, auditContextFrom(req))
      res.json({ message: 'Registration cancelled.' })
    } catch (err) {
      next(err)
    }
  },
)

// -------------------------------------------------------------- Attendance
registrationRouter.get(
  '/:id/registrations/search',
  requireAuth,
  async (req, res, next) => {
    try {
      await assertCanSearchRegistrations(req.user!.id, req.params.id!)
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      if (!q) {
        res.json({ registrations: [] })
        return
      }
      res.json({ registrations: await searchRegistrations(req.params.id!, q) })
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.post(
  '/:id/checkin',
  requireConferencePermission('attendance.record'),
  validateBody(checkinSchema),
  async (req, res, next) => {
    try {
      res.json(await checkinByQrToken(req.user!.id, req.params.id!, req.body.qr_token, req.body.date, auditContextFrom(req)))
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.post(
  '/:id/checkin/manual',
  requireConferencePermission('attendance.record'),
  validateBody(manualCheckinSchema),
  async (req, res, next) => {
    try {
      res.json(
        await checkinByRegistrationId(req.user!.id, req.params.id!, req.body.registration_id, req.body.date, auditContextFrom(req)),
      )
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.post(
  '/:id/checkin/:registrationId/checkout',
  requireConferencePermission('attendance.record'),
  async (req, res, next) => {
    try {
      await checkout(req.user!.id, req.params.id!, req.params.registrationId!, auditContextFrom(req))
      res.json({ message: 'Checked out.' })
    } catch (err) {
      next(err)
    }
  },
)

registrationRouter.get('/:id/attendance/dashboard', requireConferencePermission('attendance.record'), async (req, res, next) => {
  try {
    res.json(await getAttendanceDashboard(req.params.id!))
  } catch (err) {
    next(err)
  }
})

registrationRouter.get('/:id/attendance/recent', requireConferencePermission('attendance.record'), async (req, res, next) => {
  try {
    res.json({ checkins: await listRecentCheckins(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------- Session attendance
registrationRouter.post('/:id/sessions/:sessionId/checkin', requireAuth, validateBody(sessionCheckinSchema), async (req, res, next) => {
  try {
    await assertCanRecordSessionAttendance(req.user!.id, req.params.id!, req.params.sessionId!)
    res.json(await sessionCheckinByQrToken(req.user!.id, req.params.id!, req.params.sessionId!, req.body.qr_token, auditContextFrom(req)))
  } catch (err) {
    next(err)
  }
})

registrationRouter.post(
  '/:id/sessions/:sessionId/checkin/manual',
  requireAuth,
  validateBody(manualSessionCheckinSchema),
  async (req, res, next) => {
    try {
      await assertCanRecordSessionAttendance(req.user!.id, req.params.id!, req.params.sessionId!)
      res.json(
        await sessionCheckinByRegistrationId(
          req.user!.id,
          req.params.id!,
          req.params.sessionId!,
          req.body.registration_id,
          auditContextFrom(req),
        ),
      )
    } catch (err) {
      next(err)
    }
  },
)
