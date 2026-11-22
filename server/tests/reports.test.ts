import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import ExcelJS from 'exceljs'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { canReadAllReviews, canReadRegistrations } from '../src/modules/reports/service.js'
import {
  addConferenceMember,
  createAudienceMember,
  createConference,
  createDirectSession,
  createUser,
  resetDatabase,
} from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function cookieAgent(cookie: string) {
  return { get: (url: string) => request(app).get(url).set('Cookie', cookie) }
}

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId)
  return cookieAgent(cookie)
}

describe('reports and export', () => {
  it('downloads a submissions CSV with a header row', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-conv@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/reports/submissions/csv`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text.split('\n')[0]).toContain('Code')
  })

  it('downloads a members xlsx workbook', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-conv2@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/reports/members/xlsx`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
  })

  it('CSV export neutralises formula-like names; XLSX stores them as plain text', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-conv-csv@example.com')
    const evilId = await createUser({ email: 'reports-evil@example.com', password: 'Str0ng!Pass', fullName: '=HYPERLINK("http://evil.example","x")' })
    await addConferenceMember(conferenceId, evilId, 'reviewer')

    const csv = await agent.get(`/api/conferences/${conferenceId}/reports/members/csv`)
    expect(csv.status).toBe(200)
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`)
    expect(csv.text).not.toMatch(/(^|,)"=HYPERLINK/m)

    const xlsx = await agent.get(`/api/conferences/${conferenceId}/reports/members/xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsx.body as Buffer)
    const values: unknown[] = []
    workbook.worksheets[0]!.eachRow((row) => row.eachCell((cell) => values.push(cell.value)))
    expect(values).toContain('=HYPERLINK("http://evil.example","x")')
    expect(values.some((v) => typeof v === 'object' && v !== null && 'formula' in v)).toBe(false)
  })

  it('rejects an unknown report kind', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-conv3@example.com')
    const res = await agent.get(`/api/conferences/${conferenceId}/reports/not-a-report/csv`)
    expect(res.status).toBe(400)
  })

  it('is forbidden for an author', async () => {
    const conferenceId = await createConference()
    const authorId = await createUser({ email: 'reports-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, authorId, 'author')
    const cookie = await createDirectSession(authorId)
    const agent = cookieAgent(cookie)

    const res = await agent.get(`/api/conferences/${conferenceId}/reports/submissions/csv`)
    expect(res.status).toBe(403)
  })

  it('canReadAllReviews is true for a convenor and false for a reviewer (confidential comments stay hidden without review.read_all)', async () => {
    const conferenceId = await createConference()
    const convenorId = await createUser({ email: 'reports-crar-convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenorId, 'convenor')
    const reviewerId = await createUser({ email: 'reports-crar-reviewer@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')

    expect(await canReadAllReviews(convenorId, conferenceId)).toBe(true)
    expect(await canReadAllReviews(reviewerId, conferenceId)).toBe(false)
  })

  it('exports registrations with attendance counts, and one attendance row per check-in', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-reg-conv@example.com')
    const { userId, registrationId } = await createAudienceMember(conferenceId, 'reports-reg-att@example.com', { fullName: 'Asha Attendee' })
    await createAudienceMember(conferenceId, 'reports-reg-pending@example.com', { fullName: 'Pending Person', registrationStatus: 'pending' })
    await pool.query(
      `INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date, method) VALUES (?, ?, ?, CURDATE(), 'qr')`,
      [conferenceId, registrationId, userId],
    )

    const reg = await agent.get(`/api/conferences/${conferenceId}/reports/registrations/csv`)
    expect(reg.status).toBe(200)
    const regLines = reg.text.split('\n')
    expect(regLines[0]).toContain('Registration no.')
    expect(regLines).toHaveLength(3)
    const asha = regLines.find((l) => l.includes('Asha Attendee'))!
    expect(asha).toContain('"reports-reg-att@example.com"')
    expect(asha).toContain('"confirmed"')
    expect(asha).toMatch(/"1","0"$/)
    expect(regLines.find((l) => l.includes('Pending Person'))).toContain('"pending"')

    const att = await agent.get(`/api/conferences/${conferenceId}/reports/attendance/csv`)
    expect(att.status).toBe(200)
    const attLines = att.text.split('\n')
    expect(attLines).toHaveLength(2)
    expect(attLines[1]).toContain('Asha Attendee')
    expect(attLines[1]).toContain('"QR scan"')
    expect(attLines[1]).toMatch(/"\d{4}-\d{2}-\d{2} \d{2}:\d{2}"/)

    const xlsx = await agent.get(`/api/conferences/${conferenceId}/reports/attendance/xlsx`)
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers['content-type']).toContain('spreadsheetml')
  })

  it("does not include another conference's registrations", async () => {
    const conferenceId = await createConference()
    const otherId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-scope-conv@example.com')
    await createAudienceMember(otherId, 'reports-scope-other@example.com', { fullName: 'Other Conference Person' })

    const res = await agent.get(`/api/conferences/${conferenceId}/reports/registrations/csv`)
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('Other Conference Person')
  })

  it('registration exports are forbidden for staff (no report.view) and attendees', async () => {
    const conferenceId = await createConference()
    const staffId = await createUser({ email: 'reports-staff@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, staffId, 'staff')
    const staff = cookieAgent(await createDirectSession(staffId))
    const { cookie } = await createAudienceMember(conferenceId, 'reports-attendee@example.com')
    const attendee = cookieAgent(cookie)

    for (const kind of ['registrations', 'attendance']) {
      expect((await staff.get(`/api/conferences/${conferenceId}/reports/${kind}/csv`)).status).toBe(403)
      expect((await attendee.get(`/api/conferences/${conferenceId}/reports/${kind}/xlsx`)).status).toBe(403)
    }
    expect(await canReadRegistrations(staffId, conferenceId)).toBe(true)
  })
})
