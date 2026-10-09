import { Router } from 'express'
import { z } from 'zod'
import { validateQuery } from '../../middleware/validate.js'
import { pool } from '../../db/pool.js'

export const conferencesPublicExtrasRouter = Router()

// Small, unauthenticated reads the public home page needs that don't fit the
// Phase 1 `GET /:slug` conference-detail shape. Kept separate from Phase 1's
// routes.ts/service.ts so that file stays untouched.

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
         WHERE d.deadline_type = ? AND c.status <> 'draft' AND c.deleted_at IS NULL`,
        [deadline_type],
      )
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
    res.json({ count: Number((rows as Array<{ count: number }>)[0]?.count ?? 0) })
  } catch (err) {
    next(err)
  }
})
