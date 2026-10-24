import { Router } from 'express'
import { requireAdmin } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { suggestionDailyRateLimit, suggestionIpRateLimit } from '../../middleware/rateLimit.js'
import { resolveSessionUser } from '../auth/session.js'
import { auditContextFrom } from '../../utils/audit.js'
import {
  createSuggestion,
  deleteSuggestion,
  exportSuggestionsCsv,
  getSuggestionAndMarkRead,
  listSuggestions,
  updateSuggestion,
} from './service.js'
import { createSuggestionSchema, exportSuggestionsQuerySchema, listSuggestionsQuerySchema, updateSuggestionSchema } from './validation.js'

/** No auth: the home page's suggestion box posts here, logged in or not. */
export const suggestionsPublicRouter = Router()

suggestionsPublicRouter.post(
  '/suggestions',
  suggestionIpRateLimit,
  suggestionDailyRateLimit,
  validateBody(createSuggestionSchema),
  async (req, res, next) => {
    try {
      // Honeypot: a real visitor never fills this hidden field in. Pretend
      // success without writing anything, so a bot gets no signal at all.
      if (req.body.website) {
        res.json({ ok: true })
        return
      }

      const user = await resolveSessionUser(req)
      await createSuggestion(req.body, {
        userId: user?.id ?? null,
        ...auditContextFrom(req),
      })
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  },
)

export const suggestionsAdminRouter = Router()

suggestionsAdminRouter.get(
  '/suggestions/export.csv',
  requireAdmin,
  validateQuery(exportSuggestionsQuerySchema),
  async (req, res, next) => {
    try {
      const csv = await exportSuggestionsCsv(req.query as never)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="suggestions.csv"')
      res.send(csv)
    } catch (err) {
      next(err)
    }
  },
)

suggestionsAdminRouter.get('/suggestions', requireAdmin, validateQuery(listSuggestionsQuerySchema), async (req, res, next) => {
  try {
    res.json(await listSuggestions(req.query as never))
  } catch (err) {
    next(err)
  }
})

suggestionsAdminRouter.get('/suggestions/:id', requireAdmin, async (req, res, next) => {
  try {
    const suggestion = await getSuggestionAndMarkRead(req.user!.id, req.params.id!, auditContextFrom(req))
    res.json({ suggestion })
  } catch (err) {
    next(err)
  }
})

suggestionsAdminRouter.patch(
  '/suggestions/:id',
  requireAdmin,
  validateBody(updateSuggestionSchema),
  async (req, res, next) => {
    try {
      const suggestion = await updateSuggestion(req.user!.id, req.params.id!, req.body, auditContextFrom(req))
      res.json({ suggestion })
    } catch (err) {
      next(err)
    }
  },
)

suggestionsAdminRouter.delete('/suggestions/:id', requireAdmin, async (req, res, next) => {
  try {
    await deleteSuggestion(req.user!.id, req.params.id!, auditContextFrom(req))
    res.json({ message: 'Suggestion deleted.' })
  } catch (err) {
    next(err)
  }
})
