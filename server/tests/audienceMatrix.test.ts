import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createAudienceMember,
  createConference,
  createDirectSession,
  createSessionDirect,
  createSubmission,
  createTrack,
  createUser,
  resetDatabase,
  upsertConferenceSettings,
} from './helpers.js'
import { fillPath, listMountedRoutes, type MountedRoute } from './audienceMatrixRoutes.js'

/**
 * Audience permission matrix. Signed in as an Audience-only person (active 'attendee'
 * membership + confirmed registration, session bound to the conference), every route of the
 * real app is called:
 *  - every route behind an audience.* permission lets them through (never 403);
 *  - every other permission/role/admin-guarded route answers 403;
 *  - every requireAuth-only route is classified below: OWN_DATA (theirs to use, never 403) or
 *    CHECKED_IN_SERVICE (another role's action, checked in the service: 403, or 404 for a
 *    record they may not even know exists). A new requireAuth route fails this test until it is
 *    put in one list - the decision cannot be skipped.
 *  - nothing answers 5xx.
 */
const app = createApp()

/** audience.* routes - the Audience permissions (view_content, view_accepted_abstracts, ask_question, give_feedback, download_materials). */
const AUDIENCE_PERMISSION_PREFIX = '/api/conferences/:id/audience/'

/** requireAuth-only routes that act on the caller's own account, registration, agenda, ticket, notifications or feedback. */
const OWN_DATA = new Set([
  // Payment receipt: always the caller's own latest registration (receipts.ts, user_id = caller).
  'POST /api/conferences/:id/my-registration/receipt',
  'GET /api/conferences/:id/my-registration/receipt',
  'GET /api/auth/me',
  'GET /api/auth/my-conferences',
  'PATCH /api/auth/profile',
  'POST /api/auth/change-password',
  'POST /api/auth/request-role',
  'POST /api/auth/switch-conference',
  'GET /api/me/profile',
  'PATCH /api/me/profile',
  'POST /api/me/photo',
  'DELETE /api/me/photo',
  'GET /api/me/notifications',
  'POST /api/me/notifications/:id/read',
  'POST /api/me/notifications/read-all',
  'GET /api/me/certificates',
  'GET /api/me/feedback',
  'GET /api/me/agenda-conferences',
  'GET /api/me/chair-sessions',
  'GET /api/conferences/:id/my-registration',
  'GET /api/conferences/:id/my-registration/qr.png',
  'DELETE /api/conferences/:id/my-registration',
  'POST /api/conferences/:id/register',
  'GET /api/conferences/:id/registration-categories',
  'GET /api/conferences/:id/my-ticket',
  'POST /api/conferences/:id/my-ticket/email',
  'GET /api/conferences/:id/my-agenda',
  'GET /api/conferences/:id/my-agenda.ics',
  'GET /api/conferences/:id/my-agenda-feed',
  'POST /api/conferences/:id/my-agenda-feed/reset',
  'PUT /api/conferences/:id/my-agenda/:sessionId',
  'DELETE /api/conferences/:id/my-agenda/:sessionId',
  'GET /api/conferences/:id/my-certificates',
  'GET /api/conferences/:id/certificates/:certificateId/download',
  'GET /api/conferences/:id/my-presentations',
  'GET /api/conferences/:id/feedback-survey/form',
  'POST /api/conferences/:id/feedback-survey/responses',
  // Existing self-service: anyone signed in may start a paper (it makes them an author of it).
  'GET /api/conferences/:id/author-form',
  'POST /api/conferences/:id/submissions',
  // Lists only the caller's own reviewer assignments (empty for the Audience).
  'GET /api/reviewer/assignments',
])

/** requireAuth-only routes for other roles; the service refuses the Audience. Valid bodies make sure the permission check is reached. */
type CallSpec = { body?: Record<string, unknown>; query?: Record<string, string>; attachPdf?: boolean }
const CHECKED_IN_SERVICE: Record<string, CallSpec> = {
  'GET /api/conferences/:id/audience-feedback': {},
  'GET /api/conferences/:id/audience-feedback/export.csv': {},
  'GET /api/conferences/:id/email-log': {},
  'POST /api/conferences/:id/email-log/:logId/retry': {},
  'GET /api/conferences/:id/my-submissions': {},
  'GET /api/conferences/:id/registrations/search': { query: { q: 'a' } },
  'GET /api/conferences/:id/reviewers': { query: { submission_id: 'SUBMISSION' } },
  'GET /api/conferences/:id/reviewers-pending': {},
  'POST /api/conferences/:id/reviewers/:reviewerId/remind': {},
  'POST /api/conferences/:id/remind-all': {},
  'GET /api/conferences/:id/role-requests': {},
  'GET /api/conferences/:id/sessions/:sessionId/chair-view': {},
  'GET /api/conferences/:id/sessions/:sessionId/timer': {},
  'GET /api/conferences/:id/sessions/:sessionId/questions/moderate': {},
  'PATCH /api/conferences/:id/sessions/:sessionId/questions/:questionId': { body: { status: 'hidden' } },
  'DELETE /api/conferences/:id/sessions/:sessionId/questions/:questionId': {},
  'PATCH /api/conferences/:id/sessions/:sessionId/presentations/:presentationId/mark': { body: { status: 'presented' } },
  'POST /api/conferences/:id/sessions/:sessionId/checkin': { body: { qr_token: 'x'.repeat(32) } },
  'POST /api/conferences/:id/sessions/:sessionId/checkin/manual': { body: { registration_id: 'REGISTRATION' } },
  'GET /api/conferences/:id/submissions': {},
  'GET /api/conferences/:id/submissions/:sid': {},
  'POST /api/conferences/:id/submissions/:sid/assignments': { body: { reviewer_id: 'OTHER_USER', due_at: '2030-01-01T00:00:00Z' } },
  'DELETE /api/conferences/:id/assignments/:aid': { body: { reason: 'Matrix test' } },
  'POST /api/conferences/:id/conflicts': { body: { submission_id: 'SUBMISSION', user_id: 'OTHER_USER' } },
  'POST /api/conferences/:id/auto-assign/preview': { body: { reviewers_per_paper: 1, max_papers_per_reviewer: 1, only_unassigned: true } },
  'POST /api/conferences/:id/auto-assign/confirm': {
    body: { due_at: '2030-01-01T00:00:00Z', assignments: [{ submission_id: 'SUBMISSION', reviewer_id: 'OTHER_USER' }] },
  },
  'POST /api/conferences/:id/submissions/:sid/decisions': { body: { stage: 'abstract', decision: 'accepted' } },
  'GET /api/conferences/:id/submissions/:submissionId/audience-consent': {},
  'PUT /api/conferences/:id/submissions/:submissionId/audience-consent': { body: { slides_allowed: true, paper_allowed: true } },
  'GET /api/submissions/:sid': {},
  'PATCH /api/submissions/:sid': { body: { title: 'Taken over' } },
  'DELETE /api/submissions/:sid': {},
  'POST /api/submissions/:sid/submit': {},
  'POST /api/submissions/:sid/withdraw': { body: { reason: 'Matrix test' } },
  'POST /api/submissions/:sid/authors': { body: { full_name: 'Someone Else', email: 'someone@example.com' } },
  'PATCH /api/submissions/:sid/authors/:aid': { body: { full_name: 'Someone Else' } },
  'DELETE /api/submissions/:sid/authors/:aid': {},
  'POST /api/submissions/:sid/files/:kind': { attachPdf: true },
  'GET /api/submissions/:sid/files/:fileId/download': {},
  'GET /api/reviewer/assignments/:aid': {},
  'POST /api/reviewer/assignments/:aid/accept': {},
  'POST /api/reviewer/assignments/:aid/decline': { body: { reason: 'Matrix test' } },
  'POST /api/reviewer/assignments/:aid/conflict': { body: { reason: 'Matrix test' } },
  'PUT /api/reviewer/assignments/:aid/review': { body: {} },
  'POST /api/reviewer/assignments/:aid/review/submit': {
    body: { originality: 5, quality: 5, relevance: 5, methodology: 5, overall_score: 5, confidence: 5, recommendation: 'accept', comments_to_author: 'Fine.' },
  },
  'GET /api/reviewer/bids': { query: { conference_id: 'CONFERENCE' } },
  'PUT /api/reviewer/bids/:sid': { body: { preference: 'want' } },
  'POST /api/role-requests/:id/approve': {},
  'POST /api/role-requests/:id/reject': { body: { reason: 'Matrix test reason' } },
}

const STRICT_GUARDS = ['conferencePermissionGuard', 'conferenceRoleGuard', 'requireAdmin', 'requireSuperAdmin']

type Fixture = {
  conferenceId: string
  slug: string
  audienceUserId: string
  registrationId: string
  otherUserId: string
  submissionId: string
  sessionId: string
  values: Record<string, string>
}
let fx: Fixture

beforeAll(async () => {
  await resetDatabase()
  const conferenceId = await createConference({ status: 'registration_open' })
  await upsertConferenceSettings(conferenceId)
  const [rows] = await pool.query('SELECT slug FROM conferences WHERE id = ?', [conferenceId])
  const slug = (rows as Array<{ slug: string }>)[0]!.slug
  const aud = await createAudienceMember(conferenceId, 'matrix-audience@example.com')
  const author = await createUser({ email: 'matrix-author@example.com', password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, author, 'author')
  const trackId = await createTrack(conferenceId, 'Matrix track')
  const submissionId = await createSubmission(conferenceId, trackId, author, { title: 'Someone else’s paper', status: 'submitted' })
  await addSubmissionAuthor(submissionId, { fullName: 'Paper Author', email: 'matrix-author@example.com', userId: author })
  const now = Date.now()
  const sessionId = await createSessionDirect(conferenceId, { title: 'Matrix session', startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000) })
  // Hybrid and live now, so "Join online" is open to the Audience.
  await pool.query(`UPDATE conference_sessions SET delivery_mode = 'hybrid', online_url = 'https://meet.example.org/matrix' WHERE id = ?`, [sessionId])
  fx = {
    conferenceId,
    slug,
    audienceUserId: aud.userId,
    registrationId: aud.registrationId,
    otherUserId: author,
    submissionId,
    sessionId,
    values: { SUBMISSION: submissionId, OTHER_USER: author, REGISTRATION: aud.registrationId, CONFERENCE: conferenceId },
  }
})

afterAll(async () => {
  await pool.end()
})

function urlFor(route: MountedRoute): string {
  const withKnownIds = route.path
    .replace(/:(sid|submissionId)\b/g, fx.submissionId)
    .replace(/:sessionId\b/g, fx.sessionId)
    .replace(/\/files\/:kind$/, '/files/slides')
    .replace(/\/materials\/:kind\//, '/materials/material/')
  return fillPath(withKnownIds, { conferenceId: fx.conferenceId, slug: fx.slug })
}

function resolve<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {}), (_k, v) => (typeof v === 'string' && fx.values[v] ? fx.values[v] : v)) as T
}

/** The caller stays a confirmed Audience member for every request (one route cancels their own registration). */
async function restoreAudience(): Promise<void> {
  await pool.query(`UPDATE registrations SET status = 'confirmed', cancelled_at = NULL WHERE id = ?`, [fx.registrationId])
  await pool.query(`UPDATE conference_members SET status = 'active' WHERE conference_id = ? AND user_id = ? AND role_code = 'attendee'`, [
    fx.conferenceId,
    fx.audienceUserId,
  ])
}

const PDF = Buffer.from(['%PDF-1.4', '1 0 obj << /Type /Catalog >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF', ''].join(String.fromCharCode(10)))

async function call(route: MountedRoute, spec: CallSpec = {}) {
  await restoreAudience()
  const cookie = await createDirectSession(fx.audienceUserId, fx.conferenceId)
  let req = request(app)[route.method.toLowerCase() as 'get'](urlFor(route)).set('Cookie', cookie)
  if (spec.query) req = req.query(resolve(spec.query))
  if (spec.attachPdf) req = req.attach('file', PDF, 'slides.pdf')
  else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) req = req.send(resolve(spec.body ?? {}))
  return req
}

const routes = listMountedRoutes(app)
const guardOf = (r: MountedRoute) => r.middlewareNames.find((n) => STRICT_GUARDS.includes(n)) ?? (r.middlewareNames.includes('requireAuth') ? 'requireAuth' : 'none')

describe('Audience permission matrix', () => {
  it('finds the app routes', () => {
    expect(routes.length).toBeGreaterThan(250)
  })

  it('every audience.* route lets an Audience member through', async () => {
    const audienceRoutes = routes.filter((r) => r.path.startsWith(AUDIENCE_PERMISSION_PREFIX))
    expect(audienceRoutes.length).toBeGreaterThanOrEqual(12)
    const refused: string[] = []
    for (const r of audienceRoutes) {
      expect(guardOf(r), r.key).toBe('conferencePermissionGuard')
      const res = await call(r)
      if (res.status === 403 || res.status === 401 || res.status >= 500) refused.push(`${r.key} -> ${res.status}`)
    }
    expect(refused).toEqual([])
  }, 300_000)

  it('every other permission-, role- or admin-guarded route answers 403', async () => {
    const wrong: string[] = []
    for (const r of routes.filter((x) => guardOf(x) !== 'requireAuth' && guardOf(x) !== 'none' && !x.path.startsWith(AUDIENCE_PERMISSION_PREFIX))) {
      const res = await call(r)
      if (res.status !== 403) wrong.push(`${r.key} -> ${res.status}`)
    }
    expect(wrong).toEqual([])
  }, 600_000)

  it('every requireAuth-only route is classified', () => {
    const unclassified = routes
      .filter((r) => guardOf(r) === 'requireAuth' && !r.path.startsWith(AUDIENCE_PERMISSION_PREFIX))
      .map((r) => r.key)
      .filter((key) => !OWN_DATA.has(key) && !(key in CHECKED_IN_SERVICE))
    expect(unclassified).toEqual([])
  })

  it("other roles' requireAuth routes refuse the Audience (403, or 404 for records they cannot see)", async () => {
    const wrong: string[] = []
    for (const r of routes.filter((x) => x.key in CHECKED_IN_SERVICE)) {
      const res = await call(r, CHECKED_IN_SERVICE[r.key])
      if (res.status !== 403 && res.status !== 404) wrong.push(`${r.key} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`)
    }
    expect(wrong).toEqual([])
    // Nothing about the other author's paper changed.
    const [rows] = await pool.query('SELECT title, status FROM submissions WHERE id = ?', [fx.submissionId])
    expect(rows).toEqual([{ title: 'Someone else’s paper', status: 'submitted' }])
  }, 600_000)

  it('own-data routes work for the Audience member', async () => {
    const wrong: string[] = []
    for (const r of routes.filter((x) => OWN_DATA.has(x.key))) {
      const res = await call(r)
      if (res.status === 403 || res.status === 401 || res.status >= 500) wrong.push(`${r.key} -> ${res.status}`)
    }
    expect(wrong).toEqual([])
  }, 300_000)

  it('no route answers 5xx to an Audience member', async () => {
    const broken: string[] = []
    for (const r of routes.filter((x) => guardOf(x) === 'none')) {
      const res = await call(r)
      if (res.status >= 500) broken.push(`${r.key} -> ${res.status}`)
    }
    expect(broken).toEqual([])
  }, 300_000)
})
