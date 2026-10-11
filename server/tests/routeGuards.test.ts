import { describe, expect, it } from 'vitest'
import { authRouter } from '../src/modules/auth/routes.js'
import { conferencesRouter } from '../src/modules/conferences/routes.js'
import { conferencesManageRouter } from '../src/modules/conferences/manage.routes.js'
import { conferencesPublicExtrasRouter } from '../src/modules/conferences/publicExtras.routes.js'
import { conferenceRoleRequestsRouter, roleRequestsRouter } from '../src/modules/roleRequests/routes.js'
import { adminRouter } from '../src/modules/admin/routes.js'
import { platformSettingsAdminRouter, platformSettingsPublicRouter } from '../src/modules/platformSettings/routes.js'
import { adminEmailsRouter, emailsConferenceRouter } from '../src/modules/emails/routes.js'
import { deadlinesRouter } from '../src/modules/deadlines/routes.js'
import { tracksRouter } from '../src/modules/tracks/routes.js'
import { supportersRouter } from '../src/modules/supporters/routes.js'
import { scheduleRouter } from '../src/modules/schedule/routes.js'
import { settingsRouter } from '../src/modules/settings/routes.js'
import { meRouter } from '../src/modules/me/routes.js'
import { announcementsRouter, announcementsConferenceRouter } from '../src/modules/announcements/routes.js'
import { submissionsConferenceRouter, submissionsRouter } from '../src/modules/submissions/routes.js'
import { reviewsConferenceRouter, reviewerRouter } from '../src/modules/reviews/routes.js'
import { dashboardRouter } from '../src/modules/dashboard/routes.js'
import { membersRouter } from '../src/modules/members/routes.js'
import { committeesRouter } from '../src/modules/committees/routes.js'
import { speakersRouter } from '../src/modules/speakers/routes.js'
import { emailTemplatesRouter } from '../src/modules/emailTemplates/routes.js'
import { reportsRouter } from '../src/modules/reports/routes.js'
import { activityLogRouter } from '../src/modules/activityLog/routes.js'

const GUARD_MIDDLEWARE_NAMES = new Set(['requireAuth', 'requireAdmin', 'conferencePermissionGuard', 'conferenceRoleGuard'])

// Every route genuinely meant to work with no session at all — sign-up/sign-in
// itself, the forgot/reset-password flow (the whole point is the caller
// isn't logged in yet), logout (must work even if the session already
// expired), and the handful of read-only public pages (conference listing,
// announcements, public deadline/track counts for the homepage).
const PUBLIC_ROUTES = new Set([
  'authRouter POST /register',
  'authRouter POST /login',
  'authRouter POST /admin-login',
  'authRouter POST /logout',
  'authRouter POST /forgot-password',
  'authRouter POST /reset-password',
  'authRouter POST /accept-invitation',
  'conferencesRouter GET /public',
  'conferencesRouter GET /:slug',
  'conferencesPublicExtrasRouter GET /public-deadlines',
  'conferencesPublicExtrasRouter GET /public-track-count',
  'announcementsRouter GET /public',
  'scheduleRouter GET /:id/sessions/public',
  'platformSettingsPublicRouter GET /platform-settings',
])

type NamedRouter = { name: string; router: import('express').Router }

const ROUTERS: NamedRouter[] = [
  { name: 'authRouter', router: authRouter },
  { name: 'conferencesRouter', router: conferencesRouter },
  { name: 'conferencesManageRouter', router: conferencesManageRouter },
  { name: 'conferencesPublicExtrasRouter', router: conferencesPublicExtrasRouter },
  { name: 'conferenceRoleRequestsRouter', router: conferenceRoleRequestsRouter },
  { name: 'roleRequestsRouter', router: roleRequestsRouter },
  { name: 'adminRouter', router: adminRouter },
  { name: 'platformSettingsPublicRouter', router: platformSettingsPublicRouter },
  { name: 'platformSettingsAdminRouter', router: platformSettingsAdminRouter },
  { name: 'adminEmailsRouter', router: adminEmailsRouter },
  { name: 'emailsConferenceRouter', router: emailsConferenceRouter },
  { name: 'deadlinesRouter', router: deadlinesRouter },
  { name: 'tracksRouter', router: tracksRouter },
  { name: 'supportersRouter', router: supportersRouter },
  { name: 'scheduleRouter', router: scheduleRouter },
  { name: 'settingsRouter', router: settingsRouter },
  { name: 'meRouter', router: meRouter },
  { name: 'announcementsRouter', router: announcementsRouter },
  { name: 'submissionsConferenceRouter', router: submissionsConferenceRouter },
  { name: 'submissionsRouter', router: submissionsRouter },
  { name: 'reviewsConferenceRouter', router: reviewsConferenceRouter },
  { name: 'reviewerRouter', router: reviewerRouter },
  { name: 'dashboardRouter', router: dashboardRouter },
  { name: 'membersRouter', router: membersRouter },
  { name: 'committeesRouter', router: committeesRouter },
  { name: 'speakersRouter', router: speakersRouter },
  { name: 'announcementsConferenceRouter', router: announcementsConferenceRouter },
  { name: 'emailTemplatesRouter', router: emailTemplatesRouter },
  { name: 'reportsRouter', router: reportsRouter },
  { name: 'activityLogRouter', router: activityLogRouter },
]

type RouteEntry = { key: string; middlewareNames: string[] }

function listRoutes(name: string, router: import('express').Router): RouteEntry[] {
  const entries: RouteEntry[] = []
  // Express 4 Router instances expose a flat `.stack` of Layer objects for
  // routes registered directly on them (true for every router here — none
  // of these mount a nested sub-router), each with `.route.path` exactly as
  // written and `.route.stack` holding the middleware chain in order.
  for (const layer of (router as unknown as { stack: Array<Record<string, unknown>> }).stack) {
    const route = layer.route as { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> } | undefined
    if (!route) continue
    for (const method of Object.keys(route.methods)) {
      entries.push({
        key: `${name} ${method.toUpperCase()} ${route.path}`,
        middlewareNames: route.stack.map((l) => l.name),
      })
    }
  }
  return entries
}

describe('every route has an auth/permission guard unless explicitly public', () => {
  const allRoutes = ROUTERS.flatMap(({ name, router }) => listRoutes(name, router))

  it('found a non-trivial number of routes to check (sanity check the introspection itself works)', () => {
    expect(allRoutes.length).toBeGreaterThan(50)
  })

  it.each(allRoutes.map((r) => [r.key, r] as const))('%s is guarded or explicitly public', (key, route) => {
    const isPublic = PUBLIC_ROUTES.has(key)
    const isGuarded = route.middlewareNames.some((n) => GUARD_MIDDLEWARE_NAMES.has(n))
    expect(
      isPublic || isGuarded,
      `${key} has no recognised guard (${route.middlewareNames.join(', ')}) and is not in PUBLIC_ROUTES.`,
    ).toBe(true)
  })

  it('does not list a PUBLIC_ROUTES entry that no longer exists', () => {
    const allKeys = new Set(allRoutes.map((r) => r.key))
    for (const key of PUBLIC_ROUTES) {
      expect(allKeys.has(key), `${key} is in PUBLIC_ROUTES but no such route exists any more.`).toBe(true)
    }
  })
})
