import { Router } from 'express'
import { pool } from '../../db/pool.js'

export const announcementsRouter = Router()

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
