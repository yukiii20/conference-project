import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authRouter } from './modules/auth/routes.js'
import { conferencesRouter } from './modules/conferences/routes.js'
import { conferencesManageRouter } from './modules/conferences/manage.routes.js'
import { conferencesPublicExtrasRouter } from './modules/conferences/publicExtras.routes.js'
import { conferenceRoleRequestsRouter, roleRequestsRouter } from './modules/roleRequests/routes.js'
import { adminRouter } from './modules/admin/routes.js'
import { deadlinesRouter } from './modules/deadlines/routes.js'
import { tracksRouter } from './modules/tracks/routes.js'
import { supportersRouter } from './modules/supporters/routes.js'
import { scheduleRouter } from './modules/schedule/routes.js'
import { settingsRouter } from './modules/settings/routes.js'
import { meRouter } from './modules/me/routes.js'
import { announcementsRouter } from './modules/announcements/routes.js'
import { PUBLIC_DIR } from './storage/paths.js'

export function createApp() {
  const app = express()

  // Static files (logos, banners, photos, ...) are served cross-origin from
  // the Vite dev server's point of view, so the default same-origin resource
  // policy must be relaxed for this one path.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }))
  app.use(cookieParser())
  app.use(express.json({ limit: '100kb' }))

  app.use('/files/public', express.static(PUBLIC_DIR, { maxAge: '7d', immutable: true }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  app.use('/api/auth', authRouter)
  // publicExtras is mounted BEFORE the Phase 1 public router: its routes
  // (`/public-deadlines`, `/public-track-count`) are single path segments,
  // same shape as Phase 1's greedy `GET /:slug` — Express tries routers in
  // mount order, so whichever is registered first wins an otherwise-ambiguous
  // match. Mounting here first means those two literal routes are matched
  // before `/:slug` ever gets a chance to treat them as a slug value.
  app.use('/api/conferences', conferencesPublicExtrasRouter)
  app.use('/api/conferences', conferencesRouter)
  app.use('/api/conferences', conferencesManageRouter)
  app.use('/api/conferences', conferenceRoleRequestsRouter)
  app.use('/api/conferences', deadlinesRouter)
  app.use('/api/conferences', tracksRouter)
  app.use('/api/conferences', supportersRouter)
  app.use('/api/conferences', scheduleRouter)
  app.use('/api/conferences', settingsRouter)
  app.use('/api/role-requests', roleRequestsRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/me', meRouter)
  app.use('/api/announcements', announcementsRouter)

  app.use(errorHandler)

  return app
}
