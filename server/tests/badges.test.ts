import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function cookieAgent(cookie: string) {
  return {
    get: (url: string, query?: Record<string, string>) => request(app).get(url).query(query ?? {}).set('Cookie', cookie),
  }
}

async function loginAs(conferenceId: string, email: string, roleCode: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, roleCode)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function registerConfirmed(conferenceId: string, userId: string): Promise<string> {
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General')
     ON DUPLICATE KEY UPDATE code = code`,
    [conferenceId],
  )
  const [catRows] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ? LIMIT 1', [conferenceId])
  const categoryId = (catRows as Array<{ id: string }>)[0]!.id
  const [confRows] = await pool.query('SELECT code FROM conferences WHERE id = ?', [conferenceId])
  const code = (confRows as Array<{ code: string }>)[0]!.code
  const regNumber = `${code}-R${Math.floor(Math.random() * 1_000_000)}`
  await pool.query(
    `INSERT INTO registrations (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token, confirmed_at)
     VALUES (?, ?, ?, ?, 'confirmed', 0, 'NPR', ?, NOW(3))`,
    [conferenceId, userId, categoryId, regNumber, Math.random().toString(36).slice(2).padEnd(48, '0').slice(0, 48)],
  )
  const [regRows] = await pool.query('SELECT id FROM registrations WHERE conference_id = ? AND user_id = ?', [conferenceId, userId])
  return (regRows as Array<{ id: string }>)[0]!.id
}

/** pdfkit's page tree dict (`/Type /Pages /Count N`) is never compressed, unlike page content streams — this reliably reads the page count straight out of the raw bytes without a PDF-parsing dependency. */
function pdfPageCount(buffer: Buffer): number {
  const match = buffer.toString('latin1').match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/)
  return match ? Number(match[1]) : -1
}

describe('name badge printing', () => {
  it('is forbidden for a reviewer; works for staff and convenor', async () => {
    const conferenceId = await createConference()
    const { agent: reviewerAgent } = await loginAs(conferenceId, 'badge-reviewer@example.com', 'reviewer')
    const res1 = await reviewerAgent.get(`/api/conferences/${conferenceId}/registrations/badges`)
    expect(res1.status).toBe(403)

    const { agent: staffAgent } = await loginAs(conferenceId, 'badge-staff@example.com', 'staff')
    const attendeeId = await createUser({ email: 'badge-attendee@example.com', password: 'Str0ng!Pass' })
    await registerConfirmed(conferenceId, attendeeId)
    const res2 = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/badges`)
    expect(res2.status).toBe(200)
    expect(res2.body.candidates).toHaveLength(1)
  })

  it('staff cannot print a badge for a registration in a different conference', async () => {
    const conferenceA = await createConference()
    const conferenceB = await createConference()
    const { agent: staffAgent } = await loginAs(conferenceA, 'badge-staff2@example.com', 'staff')
    const otherUserId = await createUser({ email: 'badge-other@example.com', password: 'Str0ng!Pass' })
    const registrationId = await registerConfirmed(conferenceB, otherUserId)

    const res = await staffAgent.get(`/api/conferences/${conferenceA}/registrations/${registrationId}/badge.pdf`)
    expect(res.status).toBe(404)
  })

  it('shows the right role label (author/reviewer/staff/speaker beat the attendee default) and the checked-in-today flag', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'badge-conv@example.com', 'convenor')

    const { userId: authorId } = await loginAs(conferenceId, 'badge-author@example.com', 'author')
    await registerConfirmed(conferenceId, authorId)

    const { userId: plainId } = await loginAs(conferenceId, 'badge-plain@example.com', 'attendee')
    const plainRegId = await registerConfirmed(conferenceId, plainId)
    await pool.query(
      `INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date) VALUES (?, ?, ?, CURDATE())`,
      [conferenceId, plainRegId, plainId],
    )

    const res = await agent.get(`/api/conferences/${conferenceId}/registrations/badges`)
    type Candidate = { role_label: string; checked_in_today: boolean }
    const candidates = res.body.candidates as Candidate[]

    const authorCandidate = candidates.find((c) => c.role_label === 'Author')
    const attendeeCandidate = candidates.find((c) => c.role_label === 'Attendee')
    expect(authorCandidate).toBeTruthy()
    expect(attendeeCandidate).toBeTruthy()
    expect(attendeeCandidate!.checked_in_today).toBe(true)
    expect(authorCandidate!.checked_in_today).toBe(false)
  })

  it('generates an A4 sheet with the right page count (8 badges per page) and marks everyone printed', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'badge-conv2@example.com', 'convenor')

    const registrationIds: string[] = []
    for (let i = 0; i < 9; i++) {
      const userId = await createUser({ email: `badge-bulk-${i}@example.com`, password: 'Str0ng!Pass' })
      registrationIds.push(await registerConfirmed(conferenceId, userId))
    }

    const res = await agent.get(`/api/conferences/${conferenceId}/registrations/badges.pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(pdfPageCount(res.body as Buffer)).toBe(2) // 9 people, 8 per page -> 2 pages

    const [printedRows] = await pool.query(
      `SELECT COUNT(*) AS n FROM registrations WHERE conference_id = ? AND printed_at IS NOT NULL`,
      [conferenceId],
    )
    expect(Number((printedRows as Array<{ n: number }>)[0]!.n)).toBe(9)

    // "not printed yet" now excludes all of them.
    const res2 = await agent.get(`/api/conferences/${conferenceId}/registrations/badges`, { not_printed_only: '1' })
    expect(res2.body.candidates).toHaveLength(0)
  })

  it('an explicit ids selection ignores the other filters', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'badge-conv3@example.com', 'convenor')
    const { userId } = await loginAs(conferenceId, 'badge-selected@example.com', 'attendee')
    const registrationId = await registerConfirmed(conferenceId, userId)

    // role='staff' would normally exclude a plain attendee — confirming `ids` bypasses that filter entirely.
    const sheet = await agent
      .get(`/api/conferences/${conferenceId}/registrations/badges.pdf`, { role: 'staff', ids: registrationId })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(sheet.status).toBe(200)
    expect(pdfPageCount(sheet.body as Buffer)).toBe(1)
  })
})
