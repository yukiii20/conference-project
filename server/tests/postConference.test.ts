import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createUser, resetDatabase } from './helpers.js'

/** changes-nov2, Part 5: post-conference email through the existing bulk email queue. */
const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function setup() {
  const conferenceId = await createConference()
  const convenorId = await createUser({ email: 'pc-convenor@example.com', password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, convenorId, 'convenor')
  const cookie = await createDirectSession(convenorId, conferenceId)
  const staffId = await createUser({ email: 'pc-staff@example.com', password: 'Str0ng!Pass', fullName: 'Sita Staff' })
  await addConferenceMember(conferenceId, staffId, 'staff')
  const speakerId = await createUser({ email: 'pc-speaker@example.com', password: 'Str0ng!Pass', fullName: 'Ram Speaker' })
  await pool.query(`INSERT INTO conference_speakers (conference_id, user_id, full_name) VALUES (?, ?, 'Ram Speaker')`, [conferenceId, speakerId])
  return {
    conferenceId,
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
  }
}

async function endConference(conferenceId: string) {
  await pool.query(
    `UPDATE conferences SET start_date = DATE_SUB(CURDATE(), INTERVAL 5 DAY), end_date = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE id = ?`,
    [conferenceId],
  )
}

const email = (groups: string[]) => ({
  subject: 'Thank you for joining {{conference_name}}',
  body_html: '<p>Dear {{first_name}}, see {{conference_url}}</p>',
  recipient_groups: groups,
})

describe('post-conference email', () => {
  it('is refused before the conference ends; no reminder yet', async () => {
    const s = await setup()
    const state = await s.get(`/api/conferences/${s.conferenceId}/post-conference-email`)
    expect(state.status).toBe(200)
    expect(state.body).toMatchObject({ ended: false, reminder: false })
    expect(state.body.defaults.body_html).toContain('{{first_name}}')
    expect(state.body.defaults.body_html).toContain('/portal/certificates')

    const res = await s.post(`/api/conferences/${s.conferenceId}/post-conference-email/send`).send(email(['staff']))
    expect(res.status).toBe(409)
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM bulk_emails WHERE conference_id = ?', [s.conferenceId])
    expect(Number((rows as Array<{ n: number }>)[0]!.n)).toBe(0)
  })

  it('after the end: reminder shows, sending queues one email per person, then the reminder clears', async () => {
    const s = await setup()
    await endConference(s.conferenceId)
    expect((await s.get(`/api/conferences/${s.conferenceId}/post-conference-email`)).body.reminder).toBe(true)

    const preview = await s.post(`/api/conferences/${s.conferenceId}/bulk-email/recipients-preview`).send({ groups: ['speakers', 'staff'] })
    expect(preview.body.count).toBe(2)

    const res = await s.post(`/api/conferences/${s.conferenceId}/post-conference-email/send`).send(email(['speakers', 'staff']))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ recipient_count: 2, previously_sent: 0 })

    const [logs] = await pool.query(
      `SELECT recipient_email, subject, template_data FROM email_logs WHERE entity_type = 'bulk_emails' AND entity_id = ? ORDER BY recipient_email`,
      [res.body.id],
    )
    const list = logs as Array<{ recipient_email: string; subject: string; template_data: unknown }>
    expect(list.map((l) => l.recipient_email)).toEqual(['pc-speaker@example.com', 'pc-staff@example.com'])
    expect(list[0]!.subject).not.toContain('{{')

    const [kind] = await pool.query('SELECT kind FROM bulk_emails WHERE id = ?', [res.body.id])
    expect((kind as Array<{ kind: string }>)[0]!.kind).toBe('post_conference')

    const after = await s.get(`/api/conferences/${s.conferenceId}/post-conference-email`)
    expect(after.body.reminder).toBe(false)
    expect(after.body.sent).toHaveLength(1)
    expect(after.body.sent[0]).toMatchObject({ recipient_count: 2 })

    // A second send works but reports the earlier one.
    const again = await s.post(`/api/conferences/${s.conferenceId}/post-conference-email/send`).send(email(['staff']))
    expect(again.body.previously_sent).toBe(1)

    const [audit] = await pool.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'post_conference_email.send' AND conference_id = ?`, [
      s.conferenceId,
    ])
    expect(Number((audit as Array<{ n: number }>)[0]!.n)).toBe(2)
  })

  it('an empty recipient list leaves no half-made record', async () => {
    const s = await setup()
    await endConference(s.conferenceId)
    const res = await s.post(`/api/conferences/${s.conferenceId}/post-conference-email/send`).send(email(['reviewers']))
    expect(res.status).toBe(400)
    const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM bulk_emails WHERE conference_id = ?`, [s.conferenceId])
    expect(Number((rows as Array<{ n: number }>)[0]!.n)).toBe(0)
  })

  it('needs the bulk email permission', async () => {
    const s = await setup()
    const authorId = await createUser({ email: 'pc-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(s.conferenceId, authorId, 'author')
    const cookie = await createDirectSession(authorId, s.conferenceId)
    expect((await request(app).get(`/api/conferences/${s.conferenceId}/post-conference-email`).set('Cookie', cookie)).status).toBe(403)
  })
})
