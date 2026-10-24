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
  // Step 3 (programme) fixtures.
  authorEmail: 'e2e-author@example.com',
  chairEmail: 'e2e-chair@example.com',
  acceptedSubmissionTitle: 'E2E Accepted Paper',
  // Step 4 (registration/attendance/certificates) fixtures.
  staffEmail: 'e2e-staff@example.com',
  // Step 6 (role portals) fixtures.
  reviewerEmail: 'e2e-reviewer@example.com',
  managerEmail: 'e2e-manager@example.com',
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
  // suggestions is the one exception: it's a platform-wide leaf table (no
  // other fixture here references it, and real visitors never see this test
  // database), and it accepts anonymous submissions with no fixture email to
  // scope a targeted delete by — e2e/suggestions.spec.ts needs an exact
  // "new" count, so a full wipe here is the only thing that keeps it
  // deterministic across repeated runs (e.g. after a Vitest file run left
  // its own last-test suggestion behind — resetDatabase in tests/helpers.ts
  // only clears it in each test's beforeEach, not after the final test).
  await pool.query('DELETE FROM suggestions')

  const [confRows] = await pool.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [E2E.conferenceSlug])
  const existingConferenceId = (confRows as Array<{ id: string }>)[0]?.id
  if (existingConferenceId) {
    // Phase 3/4 features leave rows pointing at this conference too (reviews,
    // submissions, their files, email activity, notifications, ...) — delete
    // in FK-safe order (children before parents), same as tests/helpers.ts's
    // resetDatabase, before the conference row itself can go.
    // Step 3 (programme) tables — must go before submissions/conference
    // itself, since presentations/session_chairs reference them.
    await pool.query('DELETE FROM presentations WHERE conference_id = ?', [existingConferenceId])
    await pool.query(
      `DELETE sc FROM session_chairs sc JOIN conference_sessions cs ON cs.id = sc.session_id WHERE cs.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query('DELETE FROM conference_sessions WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM schedule_slots WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM rooms WHERE conference_id = ?', [existingConferenceId])

    // Step 4 (registration/attendance/certificates) tables.
    await pool.query('DELETE FROM certificates WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM certificate_templates WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM session_attendance WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM conference_attendance WHERE conference_id = ?', [existingConferenceId])
    await pool.query(
      `DELETE pwe FROM payment_webhook_events pwe JOIN payments p ON p.id = pwe.payment_id WHERE p.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query('DELETE FROM payments WHERE conference_id = ?', [existingConferenceId])
    await pool.query('DELETE FROM registrations WHERE conference_id = ?', [existingConferenceId])
    await pool.query(
      `DELETE rf FROM registration_fees rf JOIN registration_categories rc ON rc.id = rf.category_id WHERE rc.conference_id = ?`,
      [existingConferenceId],
    )
    await pool.query('DELETE FROM registration_categories WHERE conference_id = ?', [existingConferenceId])

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
  await pool.query('DELETE FROM users WHERE email IN (?, ?, ?, ?, ?, ?, ?)', [
    E2E.adminEmail,
    E2E.convenorEmail,
    E2E.authorEmail,
    E2E.chairEmail,
    E2E.staffEmail,
    E2E.reviewerEmail,
    E2E.managerEmail,
  ])

  await pool.query(
    `INSERT INTO conferences (slug, code, name, start_date, end_date, status, country, timezone, social_links)
     VALUES (?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'submission_open', 'NP', 'Asia/Kathmandu', JSON_OBJECT())`,
    [E2E.conferenceSlug, E2E.conferenceCode, E2E.conferenceName],
  )
  const [rows] = await pool.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [E2E.conferenceSlug])
  const conferenceId = (rows as Array<{ id: string }>)[0]!.id
  // registration_requires_payment = FALSE so the Step 4 e2e spec's
  // "register to attend" goes straight to confirmed, no manual step needed.
  await pool.query(
    'INSERT INTO conference_settings (conference_id, registration_requires_payment) VALUES (?, FALSE)',
    [conferenceId],
  )
  await pool.query(
    `INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at, closes_at)
     VALUES (?, 'registration', DATE_SUB(NOW(3), INTERVAL 1 DAY), DATE_ADD(NOW(3), INTERVAL 30 DAY))`,
    [conferenceId],
  )

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

  // Step 3 (programme) fixtures: a track, an accepted paper with its author,
  // and a session-chair-role member — so the programme Playwright spec can
  // schedule a real accepted paper and sign in as its chair without having
  // to drive the whole submission/review/decision lifecycle through the UI.
  await pool.query(`INSERT INTO conference_tracks (conference_id, name, is_active) VALUES (?, 'E2E Track', TRUE)`, [
    conferenceId,
  ])
  const [trackRows] = await pool.query('SELECT id FROM conference_tracks WHERE conference_id = ? AND name = ?', [
    conferenceId,
    'E2E Track',
  ])
  const trackId = (trackRows as Array<{ id: string }>)[0]!.id

  await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
    E2E.authorEmail,
    passwordHash,
    'E2E Author',
    '+9779833333333',
  ])
  const [authorRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [E2E.authorEmail])
  const authorId = (authorRows as Array<{ id: string }>)[0]!.id
  await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'author')`, [
    conferenceId,
    authorId,
  ])
  await pool.query(
    `INSERT INTO role_requests (user_id, conference_id, role_code, status, reviewed_by, reviewed_at)
     VALUES (?, ?, 'author', 'approved', ?, NOW(3))`,
    [authorId, conferenceId, convenorId],
  )

  await pool.query(
    `INSERT INTO submissions (conference_id, track_id, title, abstract, status, created_by)
     VALUES (?, ?, ?, 'An abstract for the programme E2E fixture.', 'accepted', ?)`,
    [conferenceId, trackId, E2E.acceptedSubmissionTitle, authorId],
  )
  const [submissionRows] = await pool.query(
    'SELECT id FROM submissions WHERE conference_id = ? AND title = ? ORDER BY created_at DESC LIMIT 1',
    [conferenceId, E2E.acceptedSubmissionTitle],
  )
  const submissionId = (submissionRows as Array<{ id: string }>)[0]!.id
  await pool.query(
    `INSERT INTO submission_authors (submission_id, user_id, author_order, full_name, email, is_corresponding)
     VALUES (?, ?, 1, 'E2E Author', ?, TRUE)`,
    [submissionId, authorId, E2E.authorEmail],
  )

  await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
    E2E.chairEmail,
    passwordHash,
    'E2E Chair',
    '+9779844444444',
  ])
  const [chairRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [E2E.chairEmail])
  const chairId = (chairRows as Array<{ id: string }>)[0]!.id
  await pool.query(
    `INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'session_chair')`,
    [conferenceId, chairId],
  )
  // Login (unlike platform-admin bypass) requires an approved role_requests
  // row for any non-convenor role, not just the conference_members row.
  await pool.query(
    `INSERT INTO role_requests (user_id, conference_id, role_code, status, reviewed_by, reviewed_at)
     VALUES (?, ?, 'session_chair', 'approved', ?, NOW(3))`,
    [chairId, conferenceId, convenorId],
  )
  // Also a reviewer in the same conference — a deliberate second role on one
  // fixture, so the shared portal's "multiple roles in one sidebar" e2e
  // scenario doesn't need its own throwaway account.
  await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'reviewer')`, [
    conferenceId,
    chairId,
  ])
  await pool.query(
    `INSERT INTO role_requests (user_id, conference_id, role_code, status, reviewed_by, reviewed_at)
     VALUES (?, ?, 'reviewer', 'approved', ?, NOW(3))`,
    [chairId, conferenceId, convenorId],
  )

  // Step 4 (registration/attendance/certificates) fixture: a staff member who can check people in.
  await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
    E2E.staffEmail,
    passwordHash,
    'E2E Staff',
    '+9779855555555',
  ])
  const [staffRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [E2E.staffEmail])
  const staffId = (staffRows as Array<{ id: string }>)[0]!.id
  await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'staff')`, [
    conferenceId,
    staffId,
  ])
  await pool.query(
    `INSERT INTO role_requests (user_id, conference_id, role_code, status, reviewed_by, reviewed_at)
     VALUES (?, ?, 'staff', 'approved', ?, NOW(3))`,
    [staffId, conferenceId, convenorId],
  )

  // Step 6 (role portals) fixtures: a reviewer and a manager, so the shared
  // portal's Playwright spec doesn't need to drive a signup/approval flow
  // just to get a signed-in reviewer, and a manager exists to sign into the
  // convenor-shell /manager portal.
  await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
    E2E.reviewerEmail,
    passwordHash,
    'E2E Reviewer',
    '+9779866666666',
  ])
  const [reviewerRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [E2E.reviewerEmail])
  const reviewerId = (reviewerRows as Array<{ id: string }>)[0]!.id
  await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'reviewer')`, [
    conferenceId,
    reviewerId,
  ])
  await pool.query(
    `INSERT INTO role_requests (user_id, conference_id, role_code, status, reviewed_by, reviewed_at)
     VALUES (?, ?, 'reviewer', 'approved', ?, NOW(3))`,
    [reviewerId, conferenceId, convenorId],
  )

  await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
    E2E.managerEmail,
    passwordHash,
    'E2E Manager',
    '+9779877777777',
  ])
  const [managerRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [E2E.managerEmail])
  const managerId = (managerRows as Array<{ id: string }>)[0]!.id
  await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'manager')`, [
    conferenceId,
    managerId,
  ])
  await pool.query(
    `INSERT INTO role_requests (user_id, conference_id, role_code, status, reviewed_by, reviewed_at)
     VALUES (?, ?, 'manager', 'approved', ?, NOW(3))`,
    [managerId, conferenceId, convenorId],
  )

  console.log(`E2E fixtures seeded in ${connectedDb}:`)
  console.log(`  conference: ${E2E.conferenceSlug} (${conferenceId})`)
  console.log(`  admin: ${E2E.adminEmail}`)
  console.log(`  convenor: ${E2E.convenorEmail}`)
  console.log(`  author: ${E2E.authorEmail} (accepted paper: ${E2E.acceptedSubmissionTitle})`)
  console.log(`  session chair: ${E2E.chairEmail}`)
  console.log(`  staff: ${E2E.staffEmail}`)
  console.log(`  reviewer: ${E2E.reviewerEmail}`)
  console.log(`  manager: ${E2E.managerEmail}`)

  await pool.end()
}

main().catch((err) => {
  console.error('E2E seed failed:', err)
  process.exit(1)
})
