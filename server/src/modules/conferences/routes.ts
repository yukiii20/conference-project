import { Router } from 'express'
import { NotFoundError } from '../../utils/errors.js'
import { getPublicConferenceBySlug, listPublicConferences } from './service.js'

export const conferencesRouter = Router()

conferencesRouter.get('/public', async (_req, res, next) => {
  try {
    const conferences = await listPublicConferences()
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
    res.json(result)
  } catch (err) {
    next(err)
  }
})
