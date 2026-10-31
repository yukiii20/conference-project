import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import compression from 'compression'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { pingDatabase, getEmailQueueCounts } from './utils/health.js'
import { authRouter } from './modules/auth/routes.js'
import { conferencesRouter } from './modules/conferences/routes.js'
import { conferencesManageRouter } from './modules/conferences/manage.routes.js'
import { conferencesPublicExtrasRouter } from './modules/conferences/publicExtras.routes.js'
import { conferenceRoleRequestsRouter, roleRequestsRouter } from './modules/roleRequests/routes.js'
import { adminRouter } from './modules/admin/routes.js'
import { platformSettingsAdminRouter, platformSettingsPublicRouter } from './modules/platformSettings/routes.js'
import { adminEmailsRouter, emailsConferenceRouter } from './modules/emails/routes.js'
import { deadlinesRouter } from './modules/deadlines/routes.js'
import { tracksRouter } from './modules/tracks/routes.js'
import { supportersRouter } from './modules/supporters/routes.js'
import { scheduleRouter } from './modules/schedule/routes.js'
import { settingsRouter } from './modules/settings/routes.js'
import { meRouter } from './modules/me/routes.js'
import { announcementsRouter, announcementsConferenceRouter } from './modules/announcements/routes.js'
import { bulkEmailRouter } from './modules/bulkEmail/routes.js'
import { badgesRouter } from './modules/badges/routes.js'
import { analyticsRouter, platformAnalyticsRouter } from './modules/analytics/routes.js'
import { submissionsConferenceRouter, submissionsRouter } from './modules/submissions/routes.js'
import { reviewsConferenceRouter, reviewerRouter } from './modules/reviews/routes.js'
import { dashboardRouter } from './modules/dashboard/routes.js'
import { membersRouter } from './modules/members/routes.js'
import { committeesRouter } from './modules/committees/routes.js'
import { speakersRouter } from './modules/speakers/routes.js'
import { emailTemplatesRouter } from './modules/emailTemplates/routes.js'
import { reportsRouter } from './modules/reports/routes.js'
import { activityLogRouter } from './modules/activityLog/routes.js'
import { registrationRouter } from './modules/registration/routes.js'
import { certificatesRouter, certificatesPublicRouter } from './modules/certificates/routes.js'
import { suggestionsAdminRouter, suggestionsPublicRouter } from './modules/suggestions/routes.js'
import { agendaFeedRouter, agendaRouter } from './modules/agenda/routes.js'
import { sessionTimerRouter } from './modules/sessionTimer/routes.js'
import { abstractBookRouter } from './modules/abstractBook/routes.js'
import { feedbackMeRouter, feedbackRouter } from './modules/feedback/routes.js'
import { PUBLIC_DIR } from './storage/paths.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Defense-in-depth against CSRF, on top of the session cookie's SameSite=Lax
 * (which already stops a cross-site form POST from carrying it in any
 * modern browser): reject any state-changing request whose Origin header is
 * present but doesn't match CLIENT_ORIGIN. A missing Origin is NOT rejected
 * here — stripped by some privacy tools/proxies, and always absent from
 * same-origin requests in some older browsers and from server-to-server/test
 * clients — so this only ever catches a verifiable cross-site attempt.
 */
function requireMatchingOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }
  const origin = req.get('origin')
  if (origin && origin !== env.CLIENT_ORIGIN) {
    res.status(403).json({ error: { message: 'Cross-origin request blocked.' } })
    return
  }
  next()
}

/**
 * An admin browsing a conference's convenor portal via "View as admin" sends
 * this header on every request made from that view — set once by the admin
 * clicking in, never by a convenor's own session. Rejecting every write
 * while it's present (regardless of what permission check the route would
 * otherwise pass — admins pass all of them) is what makes that view actually
 * read-only, not just a frontend convention the admin could bypass by hand.
 */
const ADMIN_VIEW_AS_HEADER = 'x-admin-view-as'

function blockWritesInAdminViewAsMode(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }
  if (req.get(ADMIN_VIEW_AS_HEADER)) {
    res.status(403).json({ error: { message: 'This is a read-only admin view. Sign in as the convenor to make changes.' } })
    return
  }
  next()
}

/**
 * Render puts its own proxy in front of every app, and Vercel's rewrite adds
 * no hop of its own (it forwards the original connection, it doesn't proxy
 * through a separate box) - so exactly one hop (Render's) sits between the
 * visitor and this process. TRUST_PROXY="1" is therefore the correct Render
 * value: req.ip becomes the right-most entry Render itself didn't add,
 * i.e. the real visitor IP, which is what rate limiting and the audit log
 * need. See docs/deploy-guide.md.
 */
export function parseTrustProxySetting(value: string): boolean | number | string {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)
  return value // e.g. "loopback", "uniquelocal"
}

export function createApp() {
  const app = express()

  if (env.TRUST_PROXY) {
    app.set('trust proxy', parseTrustProxySetting(env.TRUST_PROXY))
  }

  // Static files (logos, banners, photos, ...) are served cross-origin from
  // the Vite dev server's point of view, so the default same-origin resource
  // policy must be relaxed for this one path. This app otherwise only ever
  // returns JSON or a file download, so a tight CSP costs nothing here — the
  // frontend's own HTML (served separately by Vite/Nginx) needs its own CSP,
  // documented in docs/deploy.md.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          imgSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  )
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }))
  // gzip every JSON response over Render's free plan's slow outbound link -
  // the default 1kb threshold already skips tiny bodies where compressing
  // would cost more than it saves.
  app.use(compression())
  app.use(cookieParser())
  app.use(express.json({ limit: '100kb' }))
  app.use(requireMatchingOrigin)
  app.use(blockWritesInAdminViewAsMode)

  app.use('/files/public', express.static(PUBLIC_DIR, { maxAge: '7d', immutable: true }))

  const startedAt = Date.now()

  // Deliberately public (no auth) - this is what a load balancer / uptime
  // monitor polls. Only operational counts, never user data or secrets.
  app.get('/api/health', async (_req, res) => {
    const [db, email] = await Promise.all([pingDatabase(), getEmailQueueCounts()])
    const ok = db.ok
    res.status(ok ? 200 : 503).json({
      ok,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
      database: db,
      email_queue: email,
    })
  })

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
  app.use('/api/conferences', sessionTimerRouter)
  app.use('/api/conferences', abstractBookRouter)
  app.use('/api/conferences', feedbackRouter)
  app.use('/api/conferences', settingsRouter)
  app.use('/api/conferences', submissionsConferenceRouter)
  app.use('/api/conferences', reviewsConferenceRouter)
  app.use('/api/conferences', emailsConferenceRouter)
  app.use('/api/conferences', dashboardRouter)
  app.use('/api/conferences', membersRouter)
  app.use('/api/conferences', committeesRouter)
  app.use('/api/conferences', speakersRouter)
  app.use('/api/conferences', announcementsConferenceRouter)
  app.use('/api/conferences', bulkEmailRouter)
  app.use('/api/conferences', emailTemplatesRouter)
  app.use('/api/conferences', reportsRouter)
  app.use('/api/conferences', activityLogRouter)
  app.use('/api/conferences', registrationRouter)
  app.use('/api/conferences', badgesRouter)
  app.use('/api/conferences', analyticsRouter)
  app.use('/api/admin', platformAnalyticsRouter)
  app.use('/api/conferences', certificatesRouter)
  app.use('/api', certificatesPublicRouter)
  app.use('/api/submissions', submissionsRouter)
  app.use('/api/reviewer', reviewerRouter)
  app.use('/api/role-requests', roleRequestsRouter)
  app.use('/api', platformSettingsPublicRouter)
  app.use('/api', suggestionsPublicRouter)
  app.use('/api', agendaRouter)
  app.use('/api', agendaFeedRouter)
  app.use('/api', feedbackMeRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/admin', adminEmailsRouter)
  app.use('/api/admin', platformSettingsAdminRouter)
  app.use('/api/admin', suggestionsAdminRouter)
  app.use('/api/me', meRouter)
  app.use('/api/announcements', announcementsRouter)

  app.use(errorHandler)

  return app
}
