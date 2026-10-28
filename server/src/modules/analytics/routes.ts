import { Router } from 'express'
import { requireAdmin, requireConferencePermission } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { pool } from '../../db/pool.js'
import { NotFoundError } from '../../utils/errors.js'
import { getConvenorAnalytics, getPlatformAnalytics } from './service.js'
import {
  generateConvenorAnalyticsPdf,
  generateConvenorAnalyticsXlsx,
  generatePlatformAnalyticsPdf,
  generatePlatformAnalyticsXlsx,
} from './export.js'
import { dateRangeQuerySchema } from './validation.js'

export const analyticsRouter = Router()
export const platformAnalyticsRouter = Router()
const PERM = 'report.view'

async function loadConferenceName(conferenceId: string): Promise<string> {
  const [rows] = await pool.query('SELECT name FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [conferenceId])
  const row = (rows as Array<{ name: string }>)[0]
  if (!row) throw new NotFoundError('This conference does not exist.')
  return row.name
}

analyticsRouter.get(
  '/:id/analytics',
  requireConferencePermission(PERM),
  validateQuery(dateRangeQuerySchema),
  async (req, res, next) => {
    try {
      res.json(await getConvenorAnalytics(req.params.id!, req.query as never))
    } catch (err) {
      next(err)
    }
  },
)

analyticsRouter.get(
  '/:id/analytics/report.pdf',
  requireConferencePermission(PERM),
  validateQuery(dateRangeQuerySchema),
  async (req, res, next) => {
    try {
      const [data, conferenceName] = await Promise.all([
        getConvenorAnalytics(req.params.id!, req.query as never),
        loadConferenceName(req.params.id!),
      ])
      const pdf = await generateConvenorAnalyticsPdf(conferenceName, data)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', 'attachment; filename="analytics.pdf"')
      res.send(pdf)
    } catch (err) {
      next(err)
    }
  },
)

analyticsRouter.get(
  '/:id/analytics/report.xlsx',
  requireConferencePermission(PERM),
  validateQuery(dateRangeQuerySchema),
  async (req, res, next) => {
    try {
      const data = await getConvenorAnalytics(req.params.id!, req.query as never)
      const buffer = await generateConvenorAnalyticsXlsx(data)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', 'attachment; filename="analytics.xlsx"')
      res.send(buffer)
    } catch (err) {
      next(err)
    }
  },
)

platformAnalyticsRouter.get('/analytics', requireAdmin, validateQuery(dateRangeQuerySchema), async (req, res, next) => {
  try {
    res.json(await getPlatformAnalytics(req.query as never))
  } catch (err) {
    next(err)
  }
})

platformAnalyticsRouter.get('/analytics/report.pdf', requireAdmin, validateQuery(dateRangeQuerySchema), async (req, res, next) => {
  try {
    const data = await getPlatformAnalytics(req.query as never)
    const pdf = await generatePlatformAnalyticsPdf(data)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="platform-analytics.pdf"')
    res.send(pdf)
  } catch (err) {
    next(err)
  }
})

platformAnalyticsRouter.get('/analytics/report.xlsx', requireAdmin, validateQuery(dateRangeQuerySchema), async (req, res, next) => {
  try {
    const data = await getPlatformAnalytics(req.query as never)
    const buffer = await generatePlatformAnalyticsXlsx(data)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="platform-analytics.xlsx"')
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})
