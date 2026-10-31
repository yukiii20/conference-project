import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { auditContextFrom } from '../../utils/audit.js'
import {
  feedIcsByToken,
  getFeedUrl,
  getMyAgenda,
  listAgendaConferences,
  myAgendaIcs,
  resetFeedToken,
  starSession,
  unstarSession,
} from './service.js'

// Everyone manages only their own agenda, so every signed-in route is
// scoped to req.user — there's no way to name someone else's agenda.
export const agendaRouter = Router()

agendaRouter.get('/me/agenda-conferences', requireAuth, async (req, res, next) => {
  try {
    res.json({ conferences: await listAgendaConferences(req.user!.id) })
  } catch (err) {
    next(err)
  }
})

agendaRouter.get('/conferences/:id/my-agenda', requireAuth, async (req, res, next) => {
  try {
    res.json(await getMyAgenda(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

agendaRouter.get('/conferences/:id/my-agenda.ics', requireAuth, async (req, res, next) => {
  try {
    const ics = await myAgendaIcs(req.params.id!, req.user!.id)
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="my-agenda.ics"')
    res.send(ics)
  } catch (err) {
    next(err)
  }
})

agendaRouter.put('/conferences/:id/my-agenda/:sessionId', requireAuth, async (req, res, next) => {
  try {
    await starSession(req.params.id!, req.user!.id, req.params.sessionId!)
    res.json({ message: 'Added to your agenda.' })
  } catch (err) {
    next(err)
  }
})

agendaRouter.delete('/conferences/:id/my-agenda/:sessionId', requireAuth, async (req, res, next) => {
  try {
    await unstarSession(req.params.id!, req.user!.id, req.params.sessionId!)
    res.json({ message: 'Removed from your agenda.' })
  } catch (err) {
    next(err)
  }
})

agendaRouter.get('/conferences/:id/my-agenda-feed', requireAuth, async (req, res, next) => {
  try {
    res.json(await getFeedUrl(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

agendaRouter.post('/conferences/:id/my-agenda-feed/reset', requireAuth, async (req, res, next) => {
  try {
    res.json(await resetFeedToken(req.params.id!, req.user!.id, auditContextFrom(req)))
  } catch (err) {
    next(err)
  }
})

/** The private feed calendar apps subscribe to — no session cookie, the secret token in the URL is the credential. */
export const agendaFeedRouter = Router()

agendaFeedRouter.get('/calendar/:token.ics', async (req, res, next) => {
  try {
    const ics = await feedIcsByToken(req.params.token!)
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(ics)
  } catch (err) {
    next(err)
  }
})
