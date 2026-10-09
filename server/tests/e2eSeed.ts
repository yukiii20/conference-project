// Seeds fixture data into conference_cms_test for the Playwright E2E suite.
// Run with: npx tsx tests/e2eSeed.ts   (from the server/ directory)
//
// Never touches conference_cms. Forcing DB_NAME here is the same trick
// tests/setup.ts uses — but unlike setup.ts (a separate module Vitest loads
// before any test file), this is a single file, and static `import`
// statements are hoisted above all other code in a module, so a plain
// `process.env.DB_NAME = ...; import { pool } from ...` at the top would
// set the env var *after* pool.js (and the env validation it pulls in) had
// already read it — this bit a real run once, see docs/test-report.md.
// Dynamic `import()` is not hoisted, so it runs the env assignment first.
// A hard runtime assertion on the connected schema name is kept as a
// second line of defence regardless.
process.env.DB_NAME = 'conference_cms_test'

export const E2E = {
  conferenceSlug: 'e2e-conf',
  conferenceCode: 'E2ECONF',
  conferenceName: 'E2E Test Conference',
  adminEmail: 'e2e-admin@example.com',
  convenorEmail: 'e2e-convenor@example.com',
  password: 'Str0ng!Pass1',
}

async function main() {
  const { pool } = await import('../src/db/pool.js')
  const { hashPassword } = await import('../src/modules/auth/service.js')

  const [dbRows] = await pool.query('SELECT DATABASE() AS db')
  const connectedDb = (dbRows as Array<{ db: string }>)[0]?.db
  if (connectedDb !== 'conference_cms_test') {
    throw new Error(`Refusing to seed: connected to "${connectedDb}", expected "conference_cms_test".`)
  }

  const passwordHash = await hashPassword(E2E.password)

  // Idempotent: clean up only this fixture's own rows (by slug/email), never
  // a blanket wipe, so repeated runs don't touch anything else in the DB.
  const [confRows] = await pool.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [E2E.conferenceSlug])
  const existingConferenceId = (confRows as Array<{ id: string }>)[0]?.id
  if (existingConferenceId) {
    // Phase 3/4 features leave rows pointing at this conference too (reviews,
    // submissions, their files, email activity, notifications, ...) — delete
    // in FK-safe order (children before parents), same as tests/helpers.ts's
    // resetDatabase, before the conference row itself can go.
    await pool.query(
      `DELETE r FROM reviews r JOIN review_assignments ra ON ra.id = r.assignment_id WHERE ra.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query('DELETE FROM review_assignments WHERE conference_id = ?', [existingConferenceId])
    await pool.query(
      `DELETE rt FROM reviewer_tracks rt WHERE rt.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query(
      `DELETE co FROM conflicts_of_interest co JOIN submissions s ON s.id = co.submission_id WHERE s.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query(
      `DELETE sd FROM submission_decisions sd JOIN submissions s ON s.id = sd.submission_id WHERE s.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query(
      `DELETE ssh FROM submission_status_history ssh JOIN submissions s ON s.id = ssh.submission_id WHERE s.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query(
      `DELETE sf FROM submission_files sf JOIN submissions s ON s.id = sf.submission_id WHERE s.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query(
      `DELETE sa FROM submission_authors sa JOIN submissions s ON s.id = sa.submission_id WHERE s.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query('DELETE FROM submissions WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conference_counters WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conference_tracks WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM notifications WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM email_logs WHERE conference_id = ?', [existingConferenceId])
    // Convenor portal (Part A) features — same FK-safe ordering as tests/helpers.ts's resetDatabase.
    await pool.query('DELETE FROM email_templates WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM announcements WHERE conference_id = ?', [existingConferenceId])
    await pool.query(
      `DELETE cm FROM committee_members cm JOIN committees c ON c.id = cm.committee_id WHERE c.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query('DELETE FROM committees WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conference_speakers WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM role_requests WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conference_members WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conference_deadlines WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conference_settings WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conferences WHERE id = ?', [existingConferenceId])
  }
  await pool.query('DELETE FROM users WHERE email IN (?, ?)', [E2E.adminEmail, E2E.convenorEmail])

  await pool.query(
    `INSERT INTO conferences (slug, code, name, start_date, end_date, status, country, timezone, social_links)
     VALUES (?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'submission_open', 'NP', 'Asia/Kathmandu', JSON_OBJECT())`,
    [E2E.conferenceSlug, E2E.conferenceCode, E2E.conferenceName],
  )
  const [rows] = await pool.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [E2E.conferenceSlug])
  const conferenceId = (rows as Array<{ id: string }>)[0]!.id
  await pool.query('INSERT INTO conference_settings (conference_id) VALUES (?)', [conferenceId])

  await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
    E2E.adminEmail,
    passwordHash,
    'E2E Admin',
    '+9779811111111',
  ])
  const [adminRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [E2E.adminEmail])
  const adminId = (adminRows as Array<{ id: string }>)[0]!.id
  await pool.query('INSERT INTO platform_user_roles (user_id, role_code) VALUES (?, ?)', [adminId, 'admin'])

  await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
    E2E.convenorEmail,
    passwordHash,
    'E2E Convenor',
    '+9779822222222',
  ])
  const [convenorRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [E2E.convenorEmail])
  const convenorId = (convenorRows as Array<{ id: string }>)[0]!.id
  await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'convenor')`, [
    conferenceId,
    convenorId,
  ])

  console.log(`E2E fixtures seeded in ${connectedDb}:`)
  console.log(`  conference: ${E2E.conferenceSlug} (${conferenceId})`)
  console.log(`  admin: ${E2E.adminEmail}`)
  console.log(`  convenor: ${E2E.convenorEmail}`)

  await pool.end()
}

main().catch((err) => {
  console.error('E2E seed failed:', err)
  process.exit(1)
})
