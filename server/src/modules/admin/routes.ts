import { Router } from 'express'
import { requireAdmin } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  appointConvenorSchema,
  auditLogQuerySchema,
  convenorInviteSchema,
  createConferenceSchema,
  listUsersQuerySchema,
} from './validation.js'
import {
  adminResetUserPassword,
  appointConvenor,
  archiveConference,
  createConference,
  exportAuditLogCsv,
  getDashboardCounts,
  inviteConvenor,
  listAdminConferences,
  listAuditLog,
  listUsers,
  publishConference,
  reactivateUser,
  restoreConference,
  suspendUser,
} from './service.js'

export const adminRouter = Router()

adminRouter.get('/conferences', requireAdmin, async (_req, res, next) => {
  try {
    const conferences = await listAdminConferences()
    res.json({ conferences })
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/conferences', requireAdmin, validateBody(createConferenceSchema), async (req, res, next) => {
  try {
    const result = await createConference(req.user!.id, req.body)
    res.status(201).json({ id: result.id })
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/conferences/:id/publish', requireAdmin, async (req, res, next) => {
  try {
    await publishConference(req.user!.id, req.params.id!)
    res.json({ message: 'Conference published.' })
  } catch (err) {
    next(err)
  }
})

adminRouter.post(
  '/conferences/:id/convenor',
  requireAdmin,
  validateBody(appointConvenorSchema),
  async (req, res, next) => {
    try {
      await appointConvenor(req.user!.id, req.params.id!, req.body)
      res.json({ message: 'Convenor appointed.' })
    } catch (err) {
      next(err)
    }
  },
)

adminRouter.post(
  '/conferences/:id/convenor-invite',
  requireAdmin,
  validateBody(convenorInviteSchema),
  async (req, res, next) => {
    try {
      const result = await inviteConvenor(req.user!.id, req.params.id!, req.body)
      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

adminRouter.get('/users', requireAdmin, validateQuery(listUsersQuerySchema), async (req, res, next) => {
  try {
    res.json(await listUsers(req.query as never))
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/users/:id/suspend', requireAdmin, async (req, res, next) => {
  try {
    await suspendUser(req.user!.id, req.params.id!)
    res.json({ message: 'User suspended.' })
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/users/:id/reactivate', requireAdmin, async (req, res, next) => {
  try {
    await reactivateUser(req.user!.id, req.params.id!)
    res.json({ message: 'User reactivated.' })
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/users/:id/reset-password', requireAdmin, async (req, res, next) => {
  try {
    await adminResetUserPassword(req.user!.id, req.params.id!)
    res.json({ message: 'A password reset link has been sent to this user.' })
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/conferences/:id/archive', requireAdmin, async (req, res, next) => {
  try {
    await archiveConference(req.user!.id, req.params.id!)
    res.json({ message: 'Conference archived.' })
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/conferences/:id/restore', requireAdmin, async (req, res, next) => {
  try {
    await restoreConference(req.user!.id, req.params.id!)
    res.json({ message: 'Conference restored.' })
  } catch (err) {
    next(err)
  }
})

adminRouter.get('/dashboard', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getDashboardCounts())
  } catch (err) {
    next(err)
  }
})

adminRouter.get('/audit-log', requireAdmin, validateQuery(auditLogQuerySchema), async (req, res, next) => {
  try {
    res.json(await listAuditLog(req.query as never))
  } catch (err) {
    next(err)
  }
})

adminRouter.get('/audit-log/export.csv', requireAdmin, validateQuery(auditLogQuerySchema), async (req, res, next) => {
  try {
    const csv = await exportAuditLogCsv(req.query as never)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"')
    res.send(csv)
  } catch (err) {
    next(err)
  }
})
