import { Router } from 'express'
import { z } from 'zod'
import { validateQuery } from '../../middleware/validate.js'
import { pool } from '../../db/pool.js'

export const conferencesPublicExtrasRouter = Router()

// Small, unauthenticated reads the public home page needs that don't fit the
// Phase 1 `GET /:slug` conference-detail shape. Kept separate from Phase 1's
// routes.ts/service.ts so that file stays untouched.

// Same short shared cache as the other public, read-only endpoints (see
// conferences/routes.ts) - never applied to anything requiring auth.
const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'

const deadlinesQuerySchema = z.object({
  deadline_type: z.string().trim().min(1).max(50),
})

conferencesPublicExtrasRouter.get(
  '/public-deadlines',
  validateQuery(deadlinesQuerySchema),
  async (req, res, next) => {
    try {
      const { deadline_type } = req.query as unknown as { deadline_type: string }
      const [rows] = await pool.query(
        `SELECT d.conference_id, d.opens_at, d.closes_at
         FROM conference_deadlines d
         JOIN conferences c ON c.id = d.conference_id
         WHERE d.deadline_type = ? AND d.is_public = TRUE AND c.status <> 'draft' AND c.deleted_at IS NULL`,
        [deadline_type],
      )
      res.set('Cache-Control', PUBLIC_CACHE_CONTROL)
      res.json({ deadlines: rows })
    } catch (err) {
      next(err)
    }
  },
)

conferencesPublicExtrasRouter.get('/public-track-count', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS count
       FROM conference_tracks t
       JOIN conferences c ON c.id = t.conference_id
       WHERE t.is_active = TRUE AND c.status <> 'draft' AND c.deleted_at IS NULL`,
    )
    res.set('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.json({ count: Number((rows as Array<{ count: number }>)[0]?.count ?? 0) })
  } catch (err) {
    next(err)
  }
})

/**
 * Platform-wide aggregate counts for the home page's statistics band. Only totals across
 * published (non-draft) conferences are returned - never anything about an individual.
 */
conferencesPublicExtrasRouter.get('/public-stats', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM conferences c WHERE c.status <> 'draft' AND c.deleted_at IS NULL) AS conferences,
         (SELECT COUNT(*) FROM submissions s JOIN conferences c ON c.id = s.conference_id
           WHERE s.status NOT IN ('draft', 'withdrawn') AND s.deleted_at IS NULL AND c.status <> 'draft' AND c.deleted_at IS NULL) AS submissions,
         (SELECT COUNT(*) FROM registrations r JOIN conferences c ON c.id = r.conference_id
           WHERE r.status <> 'cancelled' AND c.status <> 'draft' AND c.deleted_at IS NULL) AS registrations,
         (SELECT COUNT(DISTINCT LOWER(TRIM(c.country))) FROM conferences c
           WHERE c.status <> 'draft' AND c.deleted_at IS NULL AND c.country IS NOT NULL AND TRIM(c.country) <> '') AS countries`,
    )
    const row = (rows as Array<Record<string, number | string | null>>)[0] ?? {}
    res.set('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.json({
      conferences: Number(row.conferences ?? 0),
      submissions: Number(row.submissions ?? 0),
      registrations: Number(row.registrations ?? 0),
      countries: Number(row.countries ?? 0),
    })
  } catch (err) {
    next(err)
  }
})
