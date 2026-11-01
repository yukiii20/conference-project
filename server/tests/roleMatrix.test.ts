import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createUser, makePlatformAdmin, resetDatabase } from './helpers.js'

/**
 * Role matrix (docs/role-matrix.md) as an executable check: every conference role is sent to a
 * representative read endpoint for each permission, and must be let in exactly when the
 * documented role holds that permission. "Let in" means not 401/403. An empty conference may
 * still answer 404 or 400 for some resources; that's the handler running, past the guard.
 *
 * The expected sets are written out here on purpose (not read from role_permissions), so that
 * changing the seed without updating the documented matrix fails this test.
 */
const ALL = [
  'conference.manage',
  'conference.view_internal',
  'members.manage',
  'deadline.manage',
  'registration.read_all',
  'attendance.record',
  'schedule.manage',
  'certificate.manage',
  'announcement.manage',
  'committee.manage',
  'report.view',
  'audit.read',
  'communication.bulk_email',
] as const
type Perm = (typeof ALL)[number]

const DOCUMENTED: Record<string, ReadonlySet<Perm>> = {
  convenor: new Set(ALL),
  // Everything except member management and the audit log; bulk email is convenor-only by default (04_bulk_email.sql).
  manager: new Set(ALL.filter((p) => !['members.manage', 'audit.read', 'communication.bulk_email'].includes(p))),
  staff: new Set<Perm>(['conference.view_internal', 'registration.read_all', 'attendance.record']),
  reviewer: new Set(),
  session_chair: new Set(),
  speaker: new Set(),
  author: new Set(),
}

const ENDPOINTS: Array<{ perm: Perm; path: (id: string) => string }> = [
  { perm: 'conference.manage', path: (id) => `/api/conferences/${id}/tracks` },
  { perm: 'conference.manage', path: (id) => `/api/conferences/${id}/supporters` },
  { perm: 'conference.manage', path: (id) => `/api/conferences/${id}/speakers` },
  { perm: 'conference.manage', path: (id) => `/api/conferences/${id}/email-templates` },
  { perm: 'conference.view_internal', path: (id) => `/api/conferences/${id}/dashboard` },
  { perm: 'members.manage', path: (id) => `/api/conferences/${id}/members` },
  { perm: 'deadline.manage', path: (id) => `/api/conferences/${id}/deadlines` },
  { perm: 'registration.read_all', path: (id) => `/api/conferences/${id}/registrations` },
  { perm: 'registration.read_all', path: (id) => `/api/conferences/${id}/registration-fees` },
  { perm: 'attendance.record', path: (id) => `/api/conferences/${id}/attendance/dashboard` },
  { perm: 'schedule.manage', path: (id) => `/api/conferences/${id}/sessions` },
  { perm: 'schedule.manage', path: (id) => `/api/conferences/${id}/rooms` },
  { perm: 'certificate.manage', path: (id) => `/api/conferences/${id}/certificates` },
  { perm: 'announcement.manage', path: (id) => `/api/conferences/${id}/announcements` },
  { perm: 'committee.manage', path: (id) => `/api/conferences/${id}/committees` },
  { perm: 'report.view', path: (id) => `/api/conferences/${id}/reports/submissions/csv` },
  { perm: 'report.view', path: (id) => `/api/conferences/${id}/analytics` },
  { perm: 'audit.read', path: (id) => `/api/conferences/${id}/activity-log` },
  { perm: 'communication.bulk_email', path: (id) => `/api/conferences/${id}/bulk-email` },
]

const app = createApp()
let conferenceId = ''
let otherConferenceId = ''
const cookies: Record<string, string> = {}

beforeAll(async () => {
  await resetDatabase()
  conferenceId = await createConference({ name: 'Matrix Conference' })
  otherConferenceId = await createConference({ name: 'Other Conference' })
  for (const role of Object.keys(DOCUMENTED)) {
    const userId = await createUser({ email: `matrix-${role}@example.com`, password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, userId, role)
    cookies[role] = await createDirectSession(userId, conferenceId)
  }
  const attendee = await createUser({ email: 'matrix-attendee@example.com', password: 'Str0ng!Pass' })
  cookies.attendee = await createDirectSession(attendee, conferenceId)

  const otherConvenor = await createUser({ email: 'matrix-other-convenor@example.com', password: 'Str0ng!Pass' })
  await addConferenceMember(otherConferenceId, otherConvenor, 'convenor')
  cookies.otherConvenor = await createDirectSession(otherConvenor, otherConferenceId)

  const admin = await createUser({ email: 'matrix-admin@example.com', password: 'Str0ng!Pass' })
  await makePlatformAdmin(admin)
  cookies.admin = await createDirectSession(admin)
})

afterAll(async () => {
  await pool.end()
})

const denied = (status: number) => status === 401 || status === 403

describe('role matrix: the seed matches the documented matrix', () => {
  it('role_permissions holds exactly the documented permissions for each conference role', async () => {
    const [rows] = await pool.query(
      `SELECT role_code, permission_code FROM role_permissions WHERE permission_code IN (?) AND role_code IN (?)`,
      [ALL, Object.keys(DOCUMENTED)],
    )
    const actual: Record<string, string[]> = Object.fromEntries(Object.keys(DOCUMENTED).map((r) => [r, []]))
    for (const r of rows as Array<{ role_code: string; permission_code: string }>) actual[r.role_code]!.push(r.permission_code)
    for (const [role, perms] of Object.entries(DOCUMENTED)) {
      expect(actual[role]!.sort(), role).toEqual([...perms].sort())
    }
  })
})

describe('role matrix: each role reaches exactly what it is allowed to', () => {
  for (const [role, perms] of Object.entries(DOCUMENTED)) {
    it(role, async () => {
      const wrong: string[] = []
      for (const ep of ENDPOINTS) {
        const res = await request(app).get(ep.path(conferenceId)).set('Cookie', cookies[role]!)
        const allowed = perms.has(ep.perm)
        if (allowed === denied(res.status)) wrong.push(`${ep.path(':id')} (${ep.perm}) -> ${res.status}, expected ${allowed ? 'allowed' : 'denied'}`)
      }
      expect(wrong).toEqual([])
    })
  }

  it('a signed-in user with no role in the conference is denied everywhere', async () => {
    for (const ep of ENDPOINTS) {
      const res = await request(app).get(ep.path(conferenceId)).set('Cookie', cookies.attendee!)
      expect(res.status, ep.path(':id')).toBe(403)
    }
  })

  it('a convenor of another conference is denied everywhere in this one', async () => {
    for (const ep of ENDPOINTS) {
      const res = await request(app).get(ep.path(conferenceId)).set('Cookie', cookies.otherConvenor!)
      expect(res.status, ep.path(':id')).toBe(403)
    }
  })

  it('signed-out requests get 401 everywhere', async () => {
    for (const ep of ENDPOINTS) {
      const res = await request(app).get(ep.path(conferenceId))
      expect(res.status, ep.path(':id')).toBe(401)
    }
  })

  it('a platform admin passes every conference permission check', async () => {
    for (const ep of ENDPOINTS) {
      const res = await request(app).get(ep.path(conferenceId)).set('Cookie', cookies.admin!)
      expect(denied(res.status), `${ep.path(':id')} -> ${res.status}`).toBe(false)
    }
  })

  it('conference settings are convenor-only (role guard, not a permission)', async () => {
    const settings = `/api/conferences/${conferenceId}/settings`
    expect((await request(app).get(settings).set('Cookie', cookies.convenor!)).status).toBe(200)
    for (const role of ['manager', 'staff', 'reviewer', 'author']) {
      expect((await request(app).get(settings).set('Cookie', cookies[role]!)).status, role).toBe(403)
    }
  })
})
