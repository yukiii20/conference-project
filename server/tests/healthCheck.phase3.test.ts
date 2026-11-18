/**
 * HEALTH CHECK (Phase 3) - reproduction tests for the owner's known problems, at API level.
 * Written for HEALTH_REPORT.md. These tests are EXPECTED TO FAIL wherever a problem is real;
 * they are evidence, not a regression gate. They only ever touch conference_cms_test
 * (tests/setup.ts forces DB_NAME) and the disposable storage-test folder.
 *
 * Every check is recorded with soft assertions into reports/logs/p3-server-evidence.json so one
 * failing check never hides the ones after it; each `it` then fails at the end if any of its
 * checks failed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { runEmailWorkerOnce } from '../src/email/worker.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createTrack,
  createUser,
  makePlatformAdmin,
  pdfBuffer,
  resetDatabase,
  setDeadlineWindow,
  upsertConferenceSettings,
} from './helpers.js'

const app = createApp()
const PASSWORD = 'Str0ng!Pass1'

type Check = { problem: string; check: string; result: 'PASS' | 'FAIL'; detail: string }
const evidence: Check[] = []
let current: Check[] = []

function record(problem: string, check: string, ok: boolean, detail = ''): boolean {
  const row: Check = { problem, check, result: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 600) }
  evidence.push(row)
  current.push(row)
  return ok
}

/** Runs a step; an exception is recorded as a FAIL instead of aborting the rest of the test. */
async function step<T>(problem: string, check: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn()
    return value
  } catch (err) {
    record(problem, check, false, `threw: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

function failures(): string {
  return current
    .filter((c) => c.result === 'FAIL')
    .map((c) => `${c.check} -> ${c.detail}`)
    .join('\n')
}

async function clean(): Promise<void> {
  // tests/helpers.ts resetDatabase() does not know the November tables yet.
  await pool.query('DELETE FROM conference_invitations').catch(() => {})
  await pool.query('DELETE FROM conference_feedback').catch(() => {})
  await resetDatabase()
}

beforeEach(async () => {
  current = []
  await clean()
})

afterAll(async () => {
  const dir = path.resolve(process.cwd(), '..', 'reports', 'logs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'p3-server-evidence.json'), JSON.stringify(evidence, null, 2))
  await clean().catch(() => {})
  await pool.end()
})

function agentWith(cookie: string) {
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function member(conferenceId: string, email: string, role: string, fullName = 'Test User') {
  const userId = await createUser({ email, password: PASSWORD, fullName })
  await addConferenceMember(conferenceId, userId, role)
  return { userId, agent: agentWith(await createDirectSession(userId, conferenceId)) }
}

async function adminAgent(email = 'hc-admin@example.com') {
  const adminId = await createUser({ email, password: PASSWORD, fullName: 'Health Admin' })
  await makePlatformAdmin(adminId)
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/admin-login').send({ email, password: PASSWORD })
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { agent, adminId }
}

type EmailRow = {
  id: number
  conference_id: string | null
  recipient_email: string
  template_key: string
  subject: string
  status: string
  error_message: string | null
  template_data: Record<string, unknown>
}

async function emails(where: { to?: string; template?: string; conferenceId?: string } = {}): Promise<EmailRow[]> {
  const cond: string[] = ['1=1']
  const params: unknown[] = []
  if (where.to) {
    cond.push('recipient_email = ?')
    params.push(where.to)
  }
  if (where.template) {
    cond.push('template_key = ?')
    params.push(where.template)
  }
  if (where.conferenceId) {
    cond.push('conference_id = ?')
    params.push(where.conferenceId)
  }
  const [rows] = await pool.query(
    `SELECT id, conference_id, recipient_email, template_key, subject, status, error_message, template_data
     FROM email_logs WHERE ${cond.join(' AND ')} ORDER BY id`,
    params,
  )
  return rows as EmailRow[]
}

/** The one-time token inside a queued (not yet sent, so not yet redacted) email's link. Never a real inbox. */
function tokenFromEmail(row: EmailRow | undefined): string | null {
  if (!row) return null
  for (const value of Object.values(row.template_data ?? {})) {
    if (typeof value === 'string' && value.includes('token=')) {
      try {
        return new URL(value).searchParams.get('token')
      } catch {
        /* not a URL */
      }
    }
  }
  return null
}

function localDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function login(email: string, password: string, role: string, conference: string) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/login').send({ email, password, role, conference })
  return { agent, res }
}

async function issueReleasedParticipationCertificate(conferenceId: string, convenor: ReturnType<typeof agentWith>, attendeeId: string) {
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General') ON DUPLICATE KEY UPDATE code = code`,
    [conferenceId],
  )
  const [catRows] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ? LIMIT 1', [conferenceId])
  const categoryId = (catRows as Array<{ id: string }>)[0]!.id
  await pool.query(
    `INSERT INTO registrations (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token, confirmed_at)
     VALUES (?, ?, ?, ?, 'confirmed', 0, 'NPR', ?, NOW(3))`,
    [conferenceId, attendeeId, categoryId, `HC-R${Math.floor(Math.random() * 100000)}`, Math.random().toString(36).slice(2).padEnd(48, '0').slice(0, 48)],
  )
  const [regRows] = await pool.query('SELECT id FROM registrations WHERE conference_id = ? AND user_id = ?', [conferenceId, attendeeId])
  await pool.query(`INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date) VALUES (?, ?, ?, CURDATE())`, [
    conferenceId,
    (regRows as Array<{ id: string }>)[0]!.id,
    attendeeId,
  ])
  const generate = await convenor.post(`/api/conferences/${conferenceId}/certificates/generate`).send({ certificate_type: 'participation' })
  const release = await convenor.post(`/api/conferences/${conferenceId}/certificates/release-now`)
  const [certRows] = await pool.query('SELECT id, verification_token, certificate_number FROM certificates WHERE conference_id = ? LIMIT 1', [conferenceId])
  const cert = (certRows as Array<{ id: string; verification_token: string; certificate_number: string }>)[0]
  return { generate, release, cert }
}

// ---------------------------------------------------------------------------------------------
describe('P3-01 certificate visible to recipient, convenor, manager and the public', () => {
  it('can be viewed and downloaded by every expected viewer', async () => {
    const P = 'P3-01'
    const conferenceId = await createConference({ name: 'Cert Conference' })
    await upsertConferenceSettings(conferenceId)
    const convenor = await member(conferenceId, 'hc-cert-convenor@example.com', 'convenor')
    const manager = await member(conferenceId, 'hc-cert-manager@example.com', 'manager')
    const attendee = await member(conferenceId, 'hc-cert-attendee@example.com', 'author', 'Asha Attendee')
    const stranger = await member(conferenceId, 'hc-cert-stranger@example.com', 'author')

    const { generate, release, cert } = await issueReleasedParticipationCertificate(conferenceId, convenor.agent, attendee.userId)
    record(P, 'convenor issues a participation certificate', generate.status === 200 && generate.body.issued === 1, `${generate.status} ${JSON.stringify(generate.body)}`)
    record(P, 'convenor releases certificates', release.status === 200, `${release.status} ${JSON.stringify(release.body)}`)
    if (!cert) {
      record(P, 'certificate row exists', false, 'no certificate was created')
      expect(failures()).toBe('')
      return
    }

    // Recipient: My certificates + download
    const mine = await attendee.agent.get(`/api/conferences/${conferenceId}/my-certificates`)
    record(P, 'recipient sees it in My certificates (conference list)', mine.status === 200 && mine.body.certificates?.length === 1, `${mine.status} n=${mine.body.certificates?.length}`)
    const mineEverywhere = await attendee.agent.get('/api/me/certificates')
    record(P, 'recipient sees it in /api/me/certificates (portal tab)', mineEverywhere.status === 200 && (mineEverywhere.body.certificates?.length ?? 0) === 1, `${mineEverywhere.status} n=${mineEverywhere.body.certificates?.length}`)
    const dl = await attendee.agent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    record(P, 'recipient downloads the PDF', dl.status === 200 && String(dl.headers['content-type']).includes('pdf') && (dl.body as Buffer).subarray(0, 4).toString() === '%PDF', `${dl.status} ${dl.headers['content-type']} bytes=${(dl.body as Buffer)?.length}`)

    // Convenor and manager
    const convList = await convenor.agent.get(`/api/conferences/${conferenceId}/certificates`)
    record(P, 'convenor lists certificates', convList.status === 200 && convList.body.certificates?.length === 1, `${convList.status}`)
    const convDl = await convenor.agent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
    record(P, 'convenor downloads the PDF', convDl.status === 200, `${convDl.status} ${JSON.stringify(convDl.body).slice(0, 200)}`)
    const mgrList = await manager.agent.get(`/api/conferences/${conferenceId}/certificates`)
    record(P, 'manager lists certificates', mgrList.status === 200, `${mgrList.status} ${JSON.stringify(mgrList.body).slice(0, 200)}`)
    const mgrDl = await manager.agent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
    record(P, 'manager downloads the PDF', mgrDl.status === 200, `${mgrDl.status} ${JSON.stringify(mgrDl.body).slice(0, 200)}`)

    // Someone else must NOT get it through the private route
    const other = await stranger.agent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
    record(P, 'another signed-in user is refused on the private download route', other.status === 403, `${other.status}`)

    // Public verification, no login
    const verify = await request(app).get(`/api/verify/${cert.verification_token}`)
    record(P, 'public verification endpoint works without login', verify.status === 200 && verify.body.result?.valid === true, `${verify.status} ${JSON.stringify(verify.body).slice(0, 300)}`)
    record(
      P,
      'public verification shows the certificate number',
      JSON.stringify(verify.body).includes(cert.certificate_number),
      `fields returned: ${Object.keys(verify.body.result ?? {}).join(', ')}`,
    )
    const candidates = [
      `/api/verify/${cert.verification_token}/pdf`,
      `/api/verify/${cert.verification_token}/download`,
      `/api/verify/${cert.verification_token}/certificate.pdf`,
      `/api/certificates/verify/${cert.verification_token}/pdf`,
      `/api/certificates/${cert.verification_token}/download`,
    ]
    const publicResults: string[] = []
    let publicPdf = false
    for (const url of candidates) {
      const res = await request(app).get(url)
      publicResults.push(`${url.replace(cert.verification_token, '<token>')} -> ${res.status}`)
      if (res.status === 200 && String(res.headers['content-type']).includes('pdf')) publicPdf = true
    }
    record(P, 'anyone can view/download the PDF from the public verification page without login', publicPdf, publicResults.join(' | '))

    // The stored-file dependency: what the recipient gets when the PDF file is gone from storage.
    const [fileRows] = await pool.query('SELECT file_path FROM certificates WHERE id = ?', [cert.id])
    const filePath = (fileRows as Array<{ file_path: string | null }>)[0]?.file_path
    if (filePath) {
      const { storage } = await import('../src/storage/driver.js')
      await storage().delete('private', filePath)
      const gone = await attendee.agent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
      record(
        P,
        'download still works when the stored PDF is missing (generated on demand)',
        gone.status === 200,
        `${gone.status} ${JSON.stringify(gone.body).slice(0, 200)} (certificate PDFs are stored files, not regenerated)`,
      )
    }

    // Email to the recipient on release
    const certEmails = await emails({ to: 'hc-cert-attendee@example.com', template: 'certificate_available' })
    record(P, 'recipient is emailed when the certificate is released', certEmails.length === 1, `emails queued: ${certEmails.length}`)
    const releaseAgain = await convenor.agent.post(`/api/conferences/${conferenceId}/certificates/release-now`)
    const after = await emails({ to: 'hc-cert-attendee@example.com', template: 'certificate_available' })
    record(P, 'pressing "Release now" a second time does not email the recipient again', after.length === 1, `status ${releaseAgain.status}; emails after second release: ${after.length}`)

    expect(failures()).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
describe('P3-03 existing account at a second conference still gets conference emails', () => {
  it('queues and sends the conference-specific emails for conference B', async () => {
    const P = 'P3-03'
    const confA = await createConference({ name: 'Conference A', slug: 'hc-conf-a', code: 'HCA' })
    const confB = await createConference({ name: 'Conference B', slug: 'hc-conf-b', code: 'HCB' })
    await upsertConferenceSettings(confA)
    await upsertConferenceSettings(confB)
    const trackB = await createTrack(confB, 'Track B')
    await setDeadlineWindow(confB, 'abstract_submission', -1, 24)
    const convenorB = await member(confB, 'hc-convenor-b@example.com', 'convenor', 'Convenor Bee')
    const EMAIL = 'hc-existing@example.com'
    const userId = await createUser({ email: EMAIL, password: PASSWORD, fullName: 'Existing Person' })
    await addConferenceMember(confA, userId, 'author')

    // (a) joins conference B with the existing account
    const join = await request(app).post('/api/auth/join-conference').send({ email: EMAIL, password: PASSWORD, requested_role: 'author', conference: 'hc-conf-b' })
    record(P, 'existing account can ask to join conference B', join.status === 201, `${join.status} ${JSON.stringify(join.body).slice(0, 200)}`)
    const afterJoin = await emails({ conferenceId: confB })
    record(
      P,
      'joining B queues an email (to the person and/or the convenor) for conference B',
      afterJoin.length > 0,
      `emails for B after join: ${afterJoin.map((e) => `${e.template_key}->${e.recipient_email}`).join(', ') || 'none'}`,
    )

    // (b) convenor approves
    const [reqRows] = await pool.query(`SELECT id FROM role_requests WHERE user_id = ? AND conference_id = ? AND status = 'pending'`, [userId, confB])
    const requestId = (reqRows as Array<{ id: string }>)[0]?.id
    if (requestId) {
      const approve = await convenorB.agent.post(`/api/role-requests/${requestId}/approve`)
      record(P, 'convenor B approves the request', approve.status === 200, `${approve.status} ${JSON.stringify(approve.body).slice(0, 200)}`)
    } else {
      record(P, 'a pending role request exists for B', false, 'no pending role request row')
    }
    const approvalEmails = (await emails({ to: EMAIL, conferenceId: confB })).filter((e) => /approv/i.test(e.template_key))
    record(P, 'approval email for conference B is queued to the existing account', approvalEmails.length === 1, `matching: ${approvalEmails.map((e) => e.template_key).join(', ') || 'none'}; all to this person for B: ${(await emails({ to: EMAIL, conferenceId: confB })).map((e) => e.template_key).join(', ') || 'none'}`)

    // (c) the convenor ADDS the existing account with another role (invite)
    const invite = await convenorB.agent
      .post(`/api/conferences/${confB}/members/invite`)
      .send({ email: EMAIL, full_name: 'Existing Person', phone: '9812345678', role_code: 'reviewer' })
    record(P, 'convenor B invites the existing account as reviewer', invite.status === 201, `${invite.status} ${JSON.stringify(invite.body).slice(0, 300)}`)
    const inviteEmails = await emails({ to: EMAIL, conferenceId: confB, template: 'member_invitation' })
    record(P, 'invitation email for conference B is queued to the existing account', inviteEmails.length === 1, `member_invitation rows: ${inviteEmails.length}`)

    // (d) activity at B: submit an abstract as the existing account
    const session = agentWith(await createDirectSession(userId, confB))
    const create = await session.post(`/api/conferences/${confB}/submissions`).send({ track_id: trackB, title: 'Existing account paper at B', abstract: 'Abstract text.', keywords: [], presentation_preference: 'either' })
    const submit = create.status === 201 ? await session.post(`/api/submissions/${create.body.id}/submit`) : null
    record(P, 'existing account submits an abstract at B', submit?.status === 200, `create ${create.status}, submit ${submit?.status} ${JSON.stringify(submit?.body ?? create.body).slice(0, 200)}`)
    const submissionEmails = (await emails({ to: EMAIL, conferenceId: confB })).filter((e) => /submi/i.test(e.template_key))
    record(P, 'submission confirmation email for conference B is queued', submissionEmails.length >= 1, `matching: ${submissionEmails.map((e) => e.template_key).join(', ') || 'none'}`)

    // (e) the queue is actually processed (console mode) and the log shows it
    await runEmailWorkerOnce()
    await runEmailWorkerOnce()
    const final = await emails({ to: EMAIL, conferenceId: confB })
    const notSent = final.filter((e) => !['sent', 'delivered'].includes(e.status))
    record(P, 'every conference-B email to the existing account ends as sent in the email log', final.length > 0 && notSent.length === 0, `total ${final.length}; not sent: ${notSent.map((e) => `${e.template_key}:${e.status}:${e.error_message}`).join(', ') || 'none'}`)
    const subjects = final.map((e) => e.subject)
    record(P, 'subjects carry conference B (code HCB), not A', subjects.length > 0 && subjects.every((s) => !s.includes('[HCA]') && !/\{\{/.test(s)), subjects.join(' || '))

    // (f) convenor's Email log tab endpoint shows them
    const log = await convenorB.agent.get(`/api/conferences/${confB}/email-log`)
    const logText = JSON.stringify(log.body)
    record(P, 'convenor B sees those emails in the conference email log', log.status === 200 && logText.includes(EMAIL), `${log.status}`)

    expect(failures()).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
describe('P3-09 invitation sends an email and gives no access before accepting', () => {
  it('new email: invitation email queued, cannot sign in with that role until accepted', async () => {
    const P = 'P3-09'
    const conferenceId = await createConference({ name: 'Invite Conference', slug: 'hc-invite', code: 'HCINV' })
    await upsertConferenceSettings(conferenceId)
    const convenor = await member(conferenceId, 'hc-inv-convenor@example.com', 'convenor', 'Convenor Inviter')
    const EMAIL = 'hc-invited-new@example.com'

    const invite = await convenor.agent
      .post(`/api/conferences/${conferenceId}/members/invite`)
      .send({ email: EMAIL, full_name: 'Invited Newperson', phone: '9812345671', role_code: 'reviewer' })
    record(P, 'invite request accepted', invite.status === 201, `${invite.status} ${JSON.stringify(invite.body).slice(0, 300)}`)
    record(P, 'API reports the invitation email outcome', ['sent', 'queued'].includes(invite.body?.email?.status), `email: ${JSON.stringify(invite.body?.email)}`)

    const [mailRows] = await pool.query(
      `SELECT id, status, error_message, template_data, subject FROM email_logs WHERE recipient_email = ? AND template_key = 'member_invitation'`,
      [EMAIL],
    )
    const mail = (mailRows as Array<{ id: number; status: string; error_message: string | null; template_data: Record<string, unknown>; subject: string }>)[0]
    record(P, 'an invitation email exists in the email queue/log', Boolean(mail), mail ? `status=${mail.status} subject="${mail.subject}"` : 'no member_invitation row')
    record(P, 'the invitation email was not marked failed', Boolean(mail) && mail!.status !== 'failed', `status=${mail?.status} error=${mail?.error_message}`)

    const [memberRows] = await pool.query(
      `SELECT cm.status FROM conference_members cm JOIN users u ON u.id = cm.user_id WHERE u.email = ? AND cm.conference_id = ?`,
      [EMAIL, conferenceId],
    )
    record(P, 'no active membership exists before accepting', (memberRows as Array<{ status: string }>).every((m) => m.status !== 'active'), `rows: ${JSON.stringify(memberRows)}`)

    const before = await login(EMAIL, PASSWORD, 'reviewer', 'hc-invite')
    record(P, 'invited person cannot sign in with that role before accepting', before.res.status >= 400, `login status ${before.res.status}`)

    // The link's token is only readable before the email is sent (it is redacted afterwards) - re-issue to read it.
    const [invRows] = await pool.query(`SELECT id FROM conference_invitations WHERE email = ? AND conference_id = ? AND status = 'pending'`, [EMAIL, conferenceId])
    const invitationId = (invRows as Array<{ id: string }>)[0]?.id
    record(P, 'a pending invitation row exists', Boolean(invitationId), `invitation id ${invitationId ?? 'none'}`)
    let token: string | null = null
    if (invitationId) {
      // Read the token from a freshly queued (unsent) email: hold the row in the queue by inserting our own.
      const { generateToken, sha256 } = await import('../src/utils/crypto.js')
      token = generateToken()
      await pool.query(`UPDATE conference_invitations SET token_hash = ? WHERE id = ?`, [sha256(token), invitationId])
    }
    if (token) {
      const preview = await request(app).get(`/api/invitations/${token}`)
      record(P, 'accept screen data loads from the link token', preview.status === 200 && preview.body.invitation?.needs_password === true, `${preview.status} ${JSON.stringify(preview.body).slice(0, 200)}`)
      const acceptAgent = request.agent(app)
      const accept = await acceptAgent.post(`/api/invitations/${token}/accept`).send({ password: PASSWORD })
      record(P, 'accepting with a new password works', accept.status === 200 && accept.body.signed_in === true, `${accept.status} ${JSON.stringify(accept.body).slice(0, 200)}`)
      const after = await login(EMAIL, PASSWORD, 'reviewer', 'hc-invite')
      record(P, 'after accepting, sign-in with that role works', after.res.status === 200, `login status ${after.res.status}`)
      const reuse = await request(app).post(`/api/invitations/${token}/accept`).send({ password: PASSWORD })
      record(P, 'the invitation link cannot be used twice', reuse.status === 410, `${reuse.status}`)
    }
    expect(failures()).toBe('')
  })

  it('existing account: invitation email queued, role not usable until accepted', async () => {
    const P = 'P3-09'
    const other = await createConference({ name: 'Other Conference', slug: 'hc-other', code: 'HCOTH' })
    const conferenceId = await createConference({ name: 'Invite Conference', slug: 'hc-invite', code: 'HCINV' })
    await upsertConferenceSettings(conferenceId)
    const convenor = await member(conferenceId, 'hc-inv-convenor@example.com', 'convenor', 'Convenor Inviter')
    const EMAIL = 'hc-invited-existing@example.com'
    const userId = await createUser({ email: EMAIL, password: PASSWORD, fullName: 'Existing Invitee' })
    await addConferenceMember(other, userId, 'author')

    const invite = await convenor.agent
      .post(`/api/conferences/${conferenceId}/members/invite`)
      .send({ email: EMAIL, full_name: 'Existing Invitee', phone: '9812345672', role_code: 'manager' })
    record(P, '[existing account] invite request accepted', invite.status === 201, `${invite.status} ${JSON.stringify(invite.body).slice(0, 300)}`)
    const mails = await emails({ to: EMAIL, template: 'member_invitation', conferenceId })
    record(P, '[existing account] an invitation email is queued (not only an in-app notification)', mails.length === 1 && mails[0]!.status !== 'failed', `rows ${mails.length} status ${mails[0]?.status} err ${mails[0]?.error_message}`)
    const before = await login(EMAIL, PASSWORD, 'manager', 'hc-invite')
    record(P, '[existing account] cannot sign in as manager before accepting', before.res.status >= 400, `login status ${before.res.status}`)
    const perms = await agentWith(await createDirectSession(userId, conferenceId)).get(`/api/conferences/${conferenceId}/members`)
    record(P, '[existing account] has no manager access to the conference before accepting', perms.status === 403, `GET members -> ${perms.status}`)
    expect(failures()).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
describe('P3-10 archive a conference, recreate with the same name/slug/code', () => {
  it('reports whether recreation is allowed and whether the old data can be restored', async () => {
    const P = 'P3-10'
    const { agent } = await adminAgent()
    const body = { name: 'Reusable Conference', short_name: 'Reuse', code: 'REUSE26', slug: 'reusable-conf', start_date: localDate(1), end_date: localDate(2), city: 'Kathmandu', country: 'NP' }

    const first = await agent.post('/api/admin/conferences').send(body)
    record(P, 'create the original conference', first.status === 201, `${first.status} ${JSON.stringify(first.body).slice(0, 200)}`)
    const oldId = first.body.id as string
    if (!oldId) {
      expect(failures()).toBe('')
      return
    }
    await createTrack(oldId, 'Old Track kept for restore')

    const archive = await agent.post(`/api/admin/conferences/${oldId}/archive`)
    record(P, 'archive (delete) the conference', archive.status === 200, `${archive.status}`)

    const second = await agent.post('/api/admin/conferences').send(body)
    record(P, 'create a NEW conference with the same name, slug and code', second.status === 201, `${second.status} ${JSON.stringify(second.body).slice(0, 300)}`)
    const newId = second.body.id as string | undefined

    // Same name but a different slug and code: is the NAME alone blocked?
    const sameNameOnly = await agent.post('/api/admin/conferences').send({ ...body, code: 'REUSE27', slug: 'reusable-conf-two' })
    record(P, 'create a new conference with the same NAME only (different slug and code)', sameNameOnly.status === 201, `${sameNameOnly.status} ${JSON.stringify(sameNameOnly.body).slice(0, 200)}`)

    const [liveRows] = await pool.query('SELECT COUNT(*) AS n FROM conferences WHERE slug = ? AND deleted_at IS NULL', ['reusable-conf'])
    record(P, 'database state after the attempt: exactly one live conference owns the slug', (liveRows as Array<{ n: number }>)[0]!.n === 1, `live rows with slug reusable-conf: ${(liveRows as Array<{ n: number }>)[0]!.n} (0 = the create was rolled back)`)

    const list = await agent.get('/api/admin/conferences')
    const listText = JSON.stringify(list.body)
    record(P, 'the archived conference is still listed for the admin (so it can be found and restored)', list.status === 200 && listText.includes(oldId), `${list.status}; list contains the archived id: ${listText.includes(oldId)}; keys of a row: ${Object.keys(list.body.conferences?.[0] ?? {}).join(',')}`)

    if (newId) {
      const restoreWhileTaken = await agent.post(`/api/admin/conferences/${oldId}/restore`)
      record(
        P,
        'restoring the old conference while its slug/code are taken gives a clear answer (not a 500, not silent)',
        restoreWhileTaken.status >= 400 && restoreWhileTaken.status < 500 && /slug|code|name|another conference/i.test(JSON.stringify(restoreWhileTaken.body)),
        `${restoreWhileTaken.status} ${JSON.stringify(restoreWhileTaken.body).slice(0, 300)}`,
      )
      await agent.post(`/api/admin/conferences/${newId}/archive`)
    }
    const restore = await agent.post(`/api/admin/conferences/${oldId}/restore`)
    record(P, 'the old (archived) conference can be restored through the API', restore.status === 200, `${restore.status} ${JSON.stringify(restore.body).slice(0, 200)}`)
    const [trackRows] = await pool.query('SELECT name FROM conference_tracks WHERE conference_id = ?', [oldId])
    record(P, 'the restored conference still has its old data (track)', (trackRows as unknown[]).length === 1, `tracks: ${JSON.stringify(trackRows)}`)
    const pub = await request(app).get('/api/conferences/reusable-conf')
    record(P, 'restored conference resolves by its slug again (public API)', [200, 404].includes(pub.status), `GET /api/conferences/reusable-conf -> ${pub.status} (404 is expected while it is still a draft)`)

    expect(failures()).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
describe('P3-11 forgot password end to end', () => {
  it('request, read link from the email queue, set new password, sign in, old link dead', async () => {
    const P = 'P3-11'
    const conferenceId = await createConference({ name: 'Reset Conference', slug: 'hc-reset', code: 'HCRST' })
    const EMAIL = 'hc-forgot@example.com'
    const userId = await createUser({ email: EMAIL, password: PASSWORD, fullName: 'Forgetful Person' })
    await addConferenceMember(conferenceId, userId, 'author')

    const ask = await request(app).post('/api/auth/forgot-password').send({ email: EMAIL, conference: 'hc-reset' })
    record(P, 'forgot-password request accepted', ask.status === 200, `${ask.status}`)
    const mail = (await emails({ to: EMAIL, template: 'password_reset' })).pop()
    const token = tokenFromEmail(mail)
    record(P, 'a reset email with a link is in the email queue', Boolean(token), mail ? `status=${mail.status}; link keys: ${Object.keys(mail.template_data).join(', ')}` : 'no password_reset email queued')
    const linkValue = Object.values(mail?.template_data ?? {}).find((v) => typeof v === 'string' && v.includes('token=')) as string | undefined
    record(P, 'the link points at the conference reset page', Boolean(linkValue && /\/c\/hc-reset\/reset-password\?token=/.test(linkValue)), (linkValue ?? '').replace(/token=.*/, 'token=<redacted>'))
    if (!token) {
      expect(failures()).toBe('')
      return
    }

    const NEW = 'BrandNew!Pass2'
    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: NEW })
    record(P, 'new password is accepted', reset.status === 200, `${reset.status} ${JSON.stringify(reset.body).slice(0, 200)}`)
    const withNew = await login(EMAIL, NEW, 'author', 'hc-reset')
    record(P, 'sign-in with the new password works', withNew.res.status === 200, `${withNew.res.status}`)
    const withOld = await login(EMAIL, PASSWORD, 'author', 'hc-reset')
    record(P, 'sign-in with the old password no longer works', withOld.res.status === 401, `${withOld.res.status}`)
    const reuse = await request(app).post('/api/auth/reset-password').send({ token, password: 'Another!Pass3' })
    record(P, 'the old reset link no longer works', reuse.status === 400, `${reuse.status} ${JSON.stringify(reuse.body).slice(0, 200)}`)

    await runEmailWorkerOnce()
    const sent = (await emails({ to: EMAIL, template: 'password_reset' })).pop()
    record(P, 'the email log shows it sent, with the link redacted afterwards', sent?.status === 'sent' && !JSON.stringify(sent.template_data).includes(token), `status=${sent?.status}`)
    expect(failures()).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
describe('P3-13 super admin creates a conference and its convenor', () => {
  it('queues the set-password email and the convenor can then sign in', async () => {
    const P = 'P3-13'
    const { agent } = await adminAgent()
    const create = await agent.post('/api/admin/conferences').send({ name: 'Admin Made Conference', short_name: 'AdminMade', code: 'ADM26', slug: 'admin-made', start_date: localDate(1), end_date: localDate(2), city: 'Pokhara', country: 'NP' })
    record(P, 'admin creates the conference', create.status === 201, `${create.status} ${JSON.stringify(create.body).slice(0, 200)}`)
    const conferenceId = create.body.id as string
    if (!conferenceId) {
      expect(failures()).toBe('')
      return
    }
    const EMAIL = 'hc-new-convenor@example.com'
    const invite = await agent.post(`/api/admin/conferences/${conferenceId}/convenor-invite`).send({ full_name: 'New Convenor', email: EMAIL, phone: '9812345673' })
    record(P, 'admin creates/invites the convenor', invite.status === 200 && invite.body.invited === true, `${invite.status} ${JSON.stringify(invite.body)}`)

    const mails = await emails({ to: EMAIL })
    const mail = mails[mails.length - 1]
    const token = tokenFromEmail(mail)
    record(P, 'a set-password email is in the email queue for the convenor', Boolean(mail && token), mail ? `template=${mail.template_key} status=${mail.status} conference_id set=${mail.conference_id === conferenceId}` : 'no email queued')
    const linkValue = Object.values(mail?.template_data ?? {}).find((v) => typeof v === 'string' && v.includes('token=')) as string | undefined
    record(P, 'the link goes to /set-password', Boolean(linkValue && linkValue.includes('/set-password?token=')), (linkValue ?? '').replace(/token=[^&]*/, 'token=<redacted>'))
    record(P, 'subject has no unfilled placeholders', Boolean(mail) && !/\{\{/.test(mail!.subject), mail?.subject ?? '')

    const before = await login(EMAIL, PASSWORD, 'convenor', conferenceId)
    record(P, 'the convenor cannot sign in before setting a password', before.res.status >= 400, `${before.res.status}`)
    if (token) {
      const accept = await request(app).post('/api/auth/accept-invitation').send({ token, password: PASSWORD, conference: conferenceId })
      record(P, 'set-password link works', accept.status === 200, `${accept.status} ${JSON.stringify(accept.body).slice(0, 200)}`)
      const after = await login(EMAIL, PASSWORD, 'convenor', conferenceId)
      record(P, 'the convenor can sign in afterwards', after.res.status === 200, `${after.res.status}`)
    }
    await runEmailWorkerOnce()
    const sent = (await emails({ to: EMAIL })).pop()
    record(P, 'the email log shows the email as sent (console mode)', sent?.status === 'sent', `status=${sent?.status} error=${sent?.error_message}`)
    expect(failures()).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
describe('P3-05 supporter logo upload accepts PNG, JPEG and WEBP (server side)', () => {
  it('each format uploads without an error and is then served', async () => {
    const P = 'P3-05'
    const conferenceId = await createConference({ name: 'Logo Conference', slug: 'hc-logo', code: 'HCLOGO' })
    const convenor = await member(conferenceId, 'hc-logo-convenor@example.com', 'convenor')
    const base = sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 30, g: 90, b: 160, alpha: 1 } } })
    const files: Array<[string, string, Buffer]> = [
      ['logo.png', 'image/png', await base.clone().png().toBuffer()],
      ['logo.jpg', 'image/jpeg', await base.clone().jpeg().toBuffer()],
      ['logo.webp', 'image/webp', await base.clone().webp().toBuffer()],
    ]
    for (const [filename, contentType, buffer] of files) {
      const created = await convenor.agent.post(`/api/conferences/${conferenceId}/supporters`).send({ name: `Supporter ${filename}`, tier: 'sponsor' })
      const supporterId = created.body?.id as string | undefined
      if (!supporterId) {
        record(P, `[${filename}] create supporter`, false, `${created.status} ${JSON.stringify(created.body).slice(0, 300)}`)
        continue
      }
      const up = await convenor.agent.post(`/api/conferences/${conferenceId}/supporters/${supporterId}/logo`).attach('file', buffer, { filename, contentType })
      record(P, `[${filename}] upload returns success with a path`, up.status === 200 && typeof up.body.path === 'string', `${up.status} ${JSON.stringify(up.body).slice(0, 200)}`)
      if (up.body?.path) {
        const served = await request(app).get(`/files/public/${up.body.path}`)
        record(P, `[${filename}] the logo is served afterwards (no login)`, served.status === 200 && String(served.headers['content-type']).startsWith('image/'), `${served.status} ${served.headers['content-type']} cache-control="${served.headers['cache-control']}"`)
        const list = await convenor.agent.get(`/api/conferences/${conferenceId}/supporters`)
        record(P, `[${filename}] the supporter list returns the saved logo path`, JSON.stringify(list.body).includes(up.body.path), `${list.status}`)
      }
    }
    expect(failures()).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
describe('P3-12 the whole journey as new users (API level)', () => {
  it('account -> approval -> abstract -> review -> decision -> full paper -> programme -> register -> ticket -> check-in -> certificate -> public verify', async () => {
    const P = 'P3-12'
    const { agent: admin } = await adminAgent()

    // 1. conference + convenor
    const create = await admin.post('/api/admin/conferences').send({ name: 'Journey Conference', short_name: 'Journey', code: 'JRNY26', slug: 'journey-conf', start_date: localDate(0), end_date: localDate(1), city: 'Kathmandu', country: 'NP' })
    record(P, '01 admin creates the conference', create.status === 201, `${create.status} ${JSON.stringify(create.body).slice(0, 200)}`)
    const conferenceId = create.body.id as string
    if (!conferenceId) {
      expect(failures()).toBe('')
      return
    }
    const publish = await admin.post(`/api/admin/conferences/${conferenceId}/publish`)
    record(P, '02 admin publishes it', publish.status === 200, `${publish.status}`)
    await admin.post(`/api/admin/conferences/${conferenceId}/convenor-invite`).send({ full_name: 'Journey Convenor', email: 'j-convenor@example.com', phone: '9812345601' })
    const convToken = tokenFromEmail((await emails({ to: 'j-convenor@example.com' })).pop())
    const convAccept = await request(app).post('/api/auth/accept-invitation').send({ token: convToken, password: PASSWORD, conference: conferenceId })
    const convenorLogin = await login('j-convenor@example.com', PASSWORD, 'convenor', conferenceId)
    record(P, '03 convenor sets a password from the emailed link and signs in', convAccept.status === 200 && convenorLogin.res.status === 200, `accept ${convAccept.status}, login ${convenorLogin.res.status}`)
    const convenor = convenorLogin.agent

    // 2. convenor setup: a track, open windows
    const track = await step(P, '04 convenor creates a track', async () => {
      const res = await convenor.post(`/api/conferences/${conferenceId}/tracks`).send({ name: 'General Track' })
      record(P, '04 convenor creates a track', res.status === 201, `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
      const [rows] = await pool.query('SELECT id FROM conference_tracks WHERE conference_id = ? LIMIT 1', [conferenceId])
      return (rows as Array<{ id: string }>)[0]?.id
    })
    await step(P, '05 convenor saves key dates', async () => {
      const now = Date.now()
      const iso = (h: number) => new Date(now + h * 3_600_000).toISOString()
      const res = await convenor.put(`/api/conferences/${conferenceId}/deadlines`).send({
        deadlines: [
          { deadline_type: 'registration', opens_at: iso(-1), closes_at: iso(48), is_public: true },
          { deadline_type: 'abstract_submission', opens_at: iso(-1), closes_at: iso(48), is_public: true },
          { deadline_type: 'review', opens_at: iso(-1), closes_at: iso(48), is_public: true },
          { deadline_type: 'full_paper', opens_at: iso(-1), closes_at: iso(48), is_public: true },
          { deadline_type: 'final_paper', opens_at: iso(-1), closes_at: iso(48), is_public: true },
        ],
      })
      record(P, '05 convenor saves key dates', res.status === 200, `${res.status} ${JSON.stringify(res.body).slice(0, 300)}`)
    })
    await pool.query('UPDATE conference_settings SET registration_requires_payment = FALSE WHERE conference_id = ?', [conferenceId])

    // 3. new users sign up and get approved
    const people = [
      { email: 'j-author@example.com', name: 'Journey Author', role: 'author', phone: '9812345602' },
      { email: 'j-reviewer@example.com', name: 'Journey Reviewer', role: 'reviewer', phone: '9812345603' },
      { email: 'j-staff@example.com', name: 'Journey Staff', role: 'staff', phone: '9812345604' },
    ]
    const agents: Record<string, ReturnType<typeof request.agent>> = {}
    for (const p of people) {
      const reg = await request(app).post('/api/auth/register').send({ full_name: p.name, email: p.email, phone: p.phone, password: PASSWORD, requested_role: p.role, conference_id: conferenceId })
      const early = await login(p.email, PASSWORD, p.role, conferenceId)
      record(P, `06 ${p.role} creates an account and cannot sign in before approval`, reg.status === 201 && early.res.status >= 400, `register ${reg.status} ${JSON.stringify(reg.body).slice(0, 150)}; early login ${early.res.status}`)
    }
    const pending = await convenor.get(`/api/conferences/${conferenceId}/role-requests?status=pending`)
    record(P, '07 convenor sees the 3 pending requests', pending.status === 200 && pending.body.requests?.length === 3, `${pending.status} n=${pending.body.requests?.length}`)
    for (const r of (pending.body.requests ?? []) as Array<{ id: string }>) {
      await convenor.post(`/api/role-requests/${r.id}/approve`)
    }
    for (const p of people) {
      const res = await login(p.email, PASSWORD, p.role, conferenceId)
      agents[p.role] = res.agent
      record(P, `08 ${p.role} signs in after approval`, res.res.status === 200, `${res.res.status} ${JSON.stringify(res.res.body).slice(0, 150)}`)
    }
    const approvalMails = (await emails({ conferenceId })).filter((e) => people.some((p) => p.email === e.recipient_email))
    record(P, '09 approval emails were queued for the new users', approvalMails.length >= 3, `emails to the 3 users: ${approvalMails.map((e) => e.template_key).join(', ') || 'none'}`)

    // 4. abstract
    let submissionId: string | undefined
    await step(P, '10 author creates, attaches and submits an abstract', async () => {
      const res = await agents.author!.post(`/api/conferences/${conferenceId}/submissions`).send({ track_id: track, title: 'A Journey Through The System', abstract: 'This abstract checks the whole flow.', keywords: ['journey'], presentation_preference: 'oral' })
      submissionId = res.body.id
      const file = await agents.author!.post(`/api/submissions/${submissionId}/files/abstract`).attach('file', pdfBuffer(), { filename: 'abstract.pdf', contentType: 'application/pdf' })
      const submit = await agents.author!.post(`/api/submissions/${submissionId}/submit`)
      record(P, '10 author creates, attaches and submits an abstract', res.status === 201 && file.status === 201 && submit.status === 200 && submit.body.status === 'submitted', `create ${res.status}, file ${file.status} ${JSON.stringify(file.body).slice(0, 120)}, submit ${submit.status} ${submit.body.status ?? JSON.stringify(submit.body).slice(0, 150)}`)
    })

    // 5. review
    await step(P, '11 convenor assigns the reviewer; reviewer accepts and submits a review', async () => {
      const [rv] = await pool.query('SELECT id FROM users WHERE email = ?', ['j-reviewer@example.com'])
      const reviewerId = (rv as Array<{ id: string }>)[0]!.id
      const assign = await convenor.post(`/api/conferences/${conferenceId}/submissions/${submissionId}/assignments`).send({ reviewer_id: reviewerId, due_at: new Date(Date.now() + 24 * 3_600_000).toISOString() })
      const list = await agents.reviewer!.get(`/api/reviewer/assignments?conference_id=${conferenceId}`)
      const assignmentId = list.body.assignments?.[0]?.id
      const accept = await agents.reviewer!.post(`/api/reviewer/assignments/${assignmentId}/accept`)
      const dl = await agents.reviewer!.get(`/api/reviewer/assignments/${assignmentId}`)
      const submit = await agents.reviewer!.post(`/api/reviewer/assignments/${assignmentId}/review/submit`).send({ originality: 4, quality: 4, relevance: 5, methodology: 4, overall_score: 4, confidence: 4, recommendation: 'accept', comments_to_author: 'Clear and useful.' })
      record(P, '11 convenor assigns the reviewer; reviewer accepts and submits a review', assign.status === 201 && accept.status === 200 && dl.status === 200 && submit.status === 200, `assign ${assign.status} ${JSON.stringify(assign.body).slice(0, 150)}, list n=${list.body.assignments?.length}, accept ${accept.status}, detail ${dl.status}, submit ${submit.status} ${JSON.stringify(submit.body).slice(0, 150)}`)
    })

    // 6. decision
    await step(P, '12 convenor records an accept decision; author is told', async () => {
      const res = await convenor.post(`/api/conferences/${conferenceId}/submissions/${submissionId}/decisions`).send({ stage: 'abstract', decision: 'accepted', comments_to_author: 'Accepted.' })
      const detail = await agents.author!.get(`/api/submissions/${submissionId}`)
      const mails = (await emails({ to: 'j-author@example.com', conferenceId })).map((e) => e.template_key)
      record(P, '12 convenor records an accept decision; author is told', res.status === 201 && /accept/.test(String(detail.body.status)) && mails.some((k) => /decision|accept/i.test(k)), `decision ${res.status} ${JSON.stringify(res.body).slice(0, 150)}; author sees status "${detail.body.status}"; author emails: ${mails.join(', ')}`)
    })

    // 7. full paper
    await step(P, '13 author uploads the full paper and can download it back', async () => {
      const up = await agents.author!.post(`/api/submissions/${submissionId}/files/full_paper`).attach('file', pdfBuffer(), { filename: 'full-paper.pdf', contentType: 'application/pdf' })
      const dl = up.body?.id ? await agents.author!.get(`/api/submissions/${submissionId}/files/${up.body.id}/download`) : null
      const convDl = up.body?.id ? await convenor.get(`/api/submissions/${submissionId}/files/${up.body.id}/download`) : null
      record(P, '13 author uploads the full paper and can download it back', up.status === 201 && dl?.status === 200 && convDl?.status === 200, `upload ${up.status} ${JSON.stringify(up.body).slice(0, 150)}; author download ${dl?.status}; convenor download ${convDl?.status}`)
    })

    // 8. programme
    let sessionId: string | undefined
    await step(P, '14 convenor builds the programme (room, published session, the paper scheduled)', async () => {
      const room = await convenor.post(`/api/conferences/${conferenceId}/rooms`).send({ name: 'Main Hall', equipment: [] })
      const [roomRows] = await pool.query('SELECT id FROM rooms WHERE conference_id = ? LIMIT 1', [conferenceId])
      const roomId = (roomRows as Array<{ id: string }>)[0]?.id
      // 14:00-15:00 Nepal time on the conference's first day
      const day = localDate(0)
      const startsAt = new Date(`${day}T14:00:00+05:45`).toISOString()
      const endsAt = new Date(`${day}T15:00:00+05:45`).toISOString()
      const session = await convenor.post(`/api/conferences/${conferenceId}/sessions`).send({ title: 'Paper session one', session_type: 'paper', track_id: null, room_id: roomId, starts_at: startsAt, ends_at: endsAt, status: 'published' })
      const [sRows] = await pool.query('SELECT id FROM conference_sessions WHERE conference_id = ? LIMIT 1', [conferenceId])
      sessionId = (sRows as Array<{ id: string }>)[0]?.id
      // A paper whose full paper is in must first be approved (full_paper_submitted -> final_approved) before it can be scheduled.
      const early = await convenor.post(`/api/conferences/${conferenceId}/sessions/${sessionId}/presentations/papers`).send({ submission_id: submissionId, duration_minutes: 15 })
      const fullDecision = await convenor.post(`/api/conferences/${conferenceId}/submissions/${submissionId}/decisions`).send({ stage: 'full_paper', decision: 'accepted', comments_to_author: 'Full paper accepted.' })
      const [stRows] = await pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId])
      const statusAfter = (stRows as Array<{ status: string }>)[0]?.status
      const pres = await convenor.post(`/api/conferences/${conferenceId}/sessions/${sessionId}/presentations/papers`).send({ submission_id: submissionId, duration_minutes: 15 })
      const pub = await request(app).get('/api/conferences/journey-conf')
      record(P, '14 convenor builds the programme (room, published session, the paper scheduled)', room.status === 201 && session.status === 201 && pres.status === 201 && pub.status === 200, `room ${room.status}; session ${session.status} ${JSON.stringify(session.body).slice(0, 150)}; scheduling before the full-paper decision ${early.status} ${JSON.stringify(early.body).slice(0, 150)}; full-paper decision ${fullDecision.status} -> status ${statusAfter}; presentation ${pres.status} ${JSON.stringify(pres.body).slice(0, 200)}; public page ${pub.status}`)
    })

    // 9. register + ticket
    let registrationId: string | undefined
    await step(P, '15 author registers to attend and gets a QR ticket', async () => {
      const cats = await agents.author!.get(`/api/conferences/${conferenceId}/registration-categories`)
      let categoryId = cats.body.categories?.[0]?.id as string | undefined
      if (!categoryId) {
        const made = await convenor.post(`/api/conferences/${conferenceId}/registration-categories`).send({ code: 'general', name: 'General', is_active: true, display_order: 1 })
        categoryId = made.body.id
      }
      const reg = await agents.author!.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
      registrationId = reg.body.id
      if (reg.body.status && reg.body.status !== 'confirmed') {
        await convenor.patch(`/api/conferences/${conferenceId}/registrations/${registrationId}/confirm`)
      }
      const mine = await agents.author!.get(`/api/conferences/${conferenceId}/my-registration`)
      const qr = await agents.author!.get(`/api/conferences/${conferenceId}/my-registration/qr.png`)
      record(P, '15 author registers to attend and gets a QR ticket', reg.status === 201 && mine.body.registration?.status === 'confirmed' && qr.status === 200 && String(qr.headers['content-type']).includes('png'), `categories ${cats.status}; register ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}; my status ${mine.body.registration?.status}; qr ${qr.status} ${qr.headers['content-type']}`)
    })

    // 10. check-in by staff with the QR token
    await step(P, '16 staff checks the attendee in with the QR ticket', async () => {
      const [rows] = await pool.query('SELECT qr_token FROM registrations WHERE id = ?', [registrationId])
      const qrToken = (rows as Array<{ qr_token: string }>)[0]?.qr_token
      const res = await agents.staff!.post(`/api/conferences/${conferenceId}/checkin`).send({ qr_token: qrToken })
      const again = await agents.staff!.post(`/api/conferences/${conferenceId}/checkin`).send({ qr_token: qrToken })
      record(P, '16 staff checks the attendee in with the QR ticket', res.status === 200 && again.status < 500, `checkin ${res.status} ${JSON.stringify(res.body).slice(0, 200)}; second scan ${again.status} ${JSON.stringify(again.body).slice(0, 120)}`)
    })

    // 11. certificate: issue, release, recipient download, public verify
    await step(P, '17 convenor issues and releases a certificate; recipient downloads; public verifies', async () => {
      const gen = await convenor.post(`/api/conferences/${conferenceId}/certificates/generate`).send({ certificate_type: 'participation' })
      const rel = await convenor.post(`/api/conferences/${conferenceId}/certificates/release-now`)
      const mine = await agents.author!.get(`/api/conferences/${conferenceId}/my-certificates`)
      const cert = mine.body.certificates?.[0]
      const dl = cert ? await agents.author!.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`) : null
      const verify = cert ? await request(app).get(`/api/verify/${cert.verification_token}`) : null
      record(P, '17 convenor issues and releases a certificate; recipient downloads; public verifies', gen.status === 200 && gen.body.issued === 1 && rel.status === 200 && dl?.status === 200 && verify?.body?.result?.valid === true, `generate ${gen.status} ${JSON.stringify(gen.body).slice(0, 200)}; release ${rel.status}; mine n=${mine.body.certificates?.length}; download ${dl?.status}; verify ${verify?.status} ${JSON.stringify(verify?.body ?? {}).slice(0, 200)}`)
    })

    // Email log for the whole journey
    await runEmailWorkerOnce()
    await runEmailWorkerOnce()
    await runEmailWorkerOnce()
    const all = await emails({ conferenceId })
    const bad = all.filter((e) => !['sent', 'delivered'].includes(e.status))
    record(P, '18 every email of the journey was sent (console mode) with no failures', all.length > 0 && bad.length === 0, `total ${all.length}: ${[...new Set(all.map((e) => e.template_key))].join(', ')}; not sent: ${bad.map((e) => `${e.template_key}:${e.status}:${e.error_message}`).join(' | ') || 'none'}`)

    expect(failures()).toBe('')
  }, 120_000)
})
