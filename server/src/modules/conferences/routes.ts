import { Router } from 'express'
import { NotFoundError } from '../../utils/errors.js'
import { getPublicConferenceBySlug, listPublicConferences } from './service.js'

export const conferencesRouter = Router()

// Short, shared cache for read-only public pages - never applied to anything
// requiring auth. max-age=60 keeps a convenor's own edit visible to them
// within about a minute; stale-while-revalidate=300 lets a CDN/browser serve
// the previous response instantly while refetching in the background rather
// than blocking the visitor on a round trip.
const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'

conferencesRouter.get('/public', async (_req, res, next) => {
  try {
    const conferences = await listPublicConferences()
    res.set('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.json({ conferences })
  } catch (err) {
    next(err)
  }
})

conferencesRouter.get('/:slug', async (req, res, next) => {
  try {
    const result = await getPublicConferenceBySlug(req.params.slug)
    if (!result) {
      throw new NotFoundError("This conference doesn't exist or hasn't been published yet.")
    }
    res.set('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.json(result)
  } catch (err) {
    next(err)
  }
})
