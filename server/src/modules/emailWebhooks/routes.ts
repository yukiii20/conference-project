import { timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { env } from '../../config/env.js'
import { applyBrevoEvents, type BrevoEvent } from './service.js'

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The token Brevo sends: "Authorization: Bearer <secret>" (preferred) or "?token=<secret>" in the URL. */
function tokenFrom(authorization: string | undefined, query: unknown): string {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (bearer) return bearer.trim()
  return typeof query === 'string' ? query : ''
}

/**
 * POST /api/webhooks/brevo. Switched off (404) until BREVO_WEBHOOK_SECRET is set. Answers 200
 * for anything it understood or chose to ignore, so Brevo doesn't retry harmless events forever.
 */
export function createBrevoWebhookRouter(
  options: { secret?: () => string | undefined; apply?: (events: BrevoEvent[]) => Promise<number> } = {},
) {
  const secretOf = options.secret ?? (() => env.BREVO_WEBHOOK_SECRET)
  const apply = options.apply ?? applyBrevoEvents
  const router = Router()

  router.post('/brevo', async (req, res, next) => {
    try {
      const secret = secretOf()
      if (!secret) {
        res.status(404).json({ message: 'Not found.' })
        return
      }
      if (!sameSecret(tokenFrom(req.get('authorization'), req.query.token), secret)) {
        res.status(401).json({ message: 'Invalid webhook token.' })
        return
      }
      const body = req.body as unknown
      const events = (Array.isArray(body) ? body : [body]).filter(
        (e): e is BrevoEvent => typeof e === 'object' && e !== null,
      )
      const updated = await apply(events)
      res.json({ received: events.length, updated })
    } catch (err) {
      next(err)
    }
  })

  return router
}
