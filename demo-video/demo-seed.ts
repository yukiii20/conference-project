// Seeds fixture data for the product video (docs/product-video.md) into
// conference_cms_test. Run with: npx tsx demo-video/demo-seed.ts   (from the repo root)
//
// Self-contained: demo-video/ has its own package.json + node_modules (mysql2,
// bcryptjs, sharp, dotenv) so this script never imports anything from
// server/src or src/ - per docs/product-video.md's SAFETY RULES ("Only
// create files in demo-video/..."). DB credentials are read from
// server/.env (same local MySQL instance as every other test script), with
// DB_NAME forced to conference_cms_test - never conference_cms.
//
// Idempotent and re-runnable: deletes only this script's own fixture rows
// (by conference slug and the "demo-" email prefixes it owns) before
// re-inserting, so running it again before re-recording a scene resets to a
// clean starting state without touching anything else in the test database.
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Loaded before DB_NAME is forced below, same as every other var here -
// server/.env holds the local MySQL host/port/user/password this script
// reuses (never a separate credential set).
dotenv.config({ path: path.join(__dirname, '../server/.env') })
dotenv.config({ path: path.join(__dirname, '.env.demo') })

const BCRYPT_COST = 12 // matches server/src/modules/auth/service.ts
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Dem0!Conference2026'

// Theme colours from docs/product-video.md, reused for the generated demo
// images so they match what the ANIMATED scenes and callouts will use.
const COLOR = {
  burgundy: '#722F37',
  cream: '#E8DCC6',
  latte: '#B7A89A',
  ink: '#2A2A2A',
}

export const DEMO = {
  conferenceSlug: 'cs26-demo',
  conferenceCode: 'CS26DEMO',
  conferenceName: 'International Conference on Cyber Security 2026',
  conferenceShortName: 'CS26',
  password: DEMO_PASSWORD,

  adminEmail: 'demo-admin@example.test',
  convenorEmail: 'demo-convenor@example.test',
  authorEmail: 'demo-author@example.test',
  reviewerEmail: 'demo-reviewer@example.test',
  staffEmail: 'demo-staff@example.test',
  // Deliberately left with NO registration by this script - scene 9 records
  // this persona registering for the first time, live.
  attendeeEmail: 'demo-attendee@example.test',

  acceptedPaperTitle: 'Zero-Trust Architectures for Critical Infrastructure',
  // Scene 5 (reviewer opens it, submits a review) - starts unreviewed so the
  // scene is re-recordable from a fresh seed every time.
  underReviewPaperTitle: 'Adversarial Robustness in Intrusion Detection Models',
  // Scene 6 (convenor accepts) - pre-seeded with ONE already-completed review
  // (not live-authored) so scene 6 is independently re-recordable without
  // first re-recording scene 5.
  readyToDecidePaperTitle: 'Federated Learning for Privacy-Preserving Threat Intelligence',

  trackNames: ['Network Security', 'Cryptography & Privacy', 'AI & Cyber Defence'],

  fakeAttendeeCount: 15,
  fakeAttendeeCheckedInCount: 9, // "some checked in" - rest stay confirmed-but-not-checked-in
}

// ---------------------------------------------------------------------------
// Simple demo image generation (sharp, SVG -> PNG) - no external assets.
// ---------------------------------------------------------------------------

async function svgToPng(svg: string, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 300 }).resize(width, height).png().toBuffer()
}

/** Square conference logo: a simple burgundy-ring monogram on cream. */
function buildLogoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${COLOR.cream}"/>
    <circle cx="256" cy="256" r="220" fill="none" stroke="${COLOR.burgundy}" stroke-width="14"/>
    <circle cx="256" cy="256" r="190" fill="none" stroke="${COLOR.latte}" stroke-width="3"/>
    <text x="256" y="278" font-family="Georgia, 'Times New Roman', serif" font-size="108" font-weight="bold"
          fill="${COLOR.burgundy}" text-anchor="middle">CS26</text>
  </svg>`
}

/**
 * Certificate background: a full-bleed A4-landscape-ratio cream backdrop with
 * a soft corner watermark. Deliberately empty in the centre/signature band -
 * the heading, recipient name, wording, and signature lines are all drawn on
 * top by server/src/modules/certificates/export.ts at generation time.
 */
function buildCertificateBackgroundSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1684" height="1190" viewBox="0 0 1684 1190">
    <rect width="1684" height="1190" fill="${COLOR.cream}"/>
    <circle cx="1480" cy="980" r="420" fill="none" stroke="${COLOR.latte}" stroke-width="10" opacity="0.18"/>
    <circle cx="1480" cy="980" r="340" fill="none" stroke="${COLOR.burgundy}" stroke-width="4" opacity="0.14"/>
    <circle cx="204" cy="210" r="420" fill="none" stroke="${COLOR.latte}" stroke-width="10" opacity="0.12"/>
  </svg>`
}

/** Signature image: a stylised cursive-like flourish, not literal text - transparent background. */
function buildSignatureSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="160" viewBox="0 0 420 160">
    <path d="M20 110 C 60 40, 90 150, 130 80 S 190 20, 220 90 S 280 140, 310 60 S 370 30, 400 70"
          fill="none" stroke="${COLOR.ink}" stroke-width="5" stroke-linecap="round"/>
    <path d="M30 128 L 360 128" fill="none" stroke="${COLOR.ink}" stroke-width="2" opacity="0.5"/>
  </svg>`
}

// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'conference_cms_test', // forced - never conference_cms
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: ['DATE'],
    timezone: 'Z',
  })
  pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"))

  const [dbRows] = await pool.query('SELECT DATABASE() AS db')
  const connectedDb = (dbRows as Row[])[0]?.db
  if (connectedDb !== 'conference_cms_test') {
    throw new Error(`Refusing to seed: connected to "${connectedDb}", expected "conference_cms_test".`)
  }

  const fakeAttendeeEmail = (n: number) => `demo-fake-${String(n).padStart(2, '0')}@example.test`
  const allOwnedEmails = [
    DEMO.adminEmail,
    DEMO.convenorEmail,
    DEMO.authorEmail,
    DEMO.reviewerEmail,
    DEMO.staffEmail,
    DEMO.attendeeEmail,
    ...Array.from({ length: DEMO.fakeAttendeeCount }, (_, i) => fakeAttendeeEmail(i + 1)),
  ]

  // --- Cleanup (idempotent, re-runnable) ----------------------------------
  const [confRows] = await pool.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [DEMO.conferenceSlug])
  const existingConferenceId = (confRows as Row[])[0]?.id as string | undefined
  if (existingConferenceId) {
    const cid = existingConferenceId
    // Scene 12 (convenor generates + releases) and scene 14 (revoke) create
    // real certificates rows referencing conference_id/template_id/
    // submission_id/session_id - delete before any of those parents.
    await pool.query('DELETE FROM certificates WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM session_attendance WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conference_attendance WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM registrations WHERE conference_id = ?', [cid])
    await pool.query(
      `DELETE rf FROM registration_fees rf JOIN registration_categories rc ON rc.id = rf.category_id WHERE rc.conference_id = ?`,
      [cid],
    )
    await pool.query('DELETE FROM registration_categories WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM presentations WHERE conference_id = ?', [cid])
    await pool.query(
      `DELETE sc FROM session_chairs sc JOIN conference_sessions cs ON cs.id = sc.session_id WHERE cs.conference_id = ?`,
      [cid],
    )
    await pool.query('DELETE FROM conference_sessions WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM schedule_slots WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM rooms WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conference_speakers WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM certificate_templates WHERE conference_id = ?', [cid])
    await pool.query(
      `DELETE r FROM reviews r JOIN review_assignments ra ON ra.id = r.assignment_id WHERE ra.conference_id = ?`,
      [cid],
    )
    await pool.query('DELETE FROM review_assignments WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM reviewer_tracks WHERE conference_id = ?', [cid])
    await pool.query(
      `DELETE sd FROM submission_decisions sd JOIN submissions s ON s.id = sd.submission_id WHERE s.conference_id = ?`,
      [cid],
    )
    await pool.query(
      `DELETE ssh FROM submission_status_history ssh JOIN submissions s ON s.id = ssh.submission_id WHERE s.conference_id = ?`,
      [cid],
    )
    await pool.query(
      `DELETE sa FROM submission_authors sa JOIN submissions s ON s.id = sa.submission_id WHERE s.conference_id = ?`,
      [cid],
    )
    // Scene 4 (author submits, live) uploads a real file - clean that up too,
    // or a re-seed after recording hits a submissions FK violation.
    await pool.query(
      `DELETE sf FROM submission_files sf JOIN submissions s ON s.id = sf.submission_id WHERE s.conference_id = ?`,
      [cid],
    )
    await pool.query(
      `DELETE co FROM conflicts_of_interest co JOIN submissions s ON s.id = co.submission_id WHERE s.conference_id = ?`,
      [cid],
    )
    await pool.query('DELETE FROM submissions WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conference_counters WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conference_tracks WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conference_members WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM role_requests WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conference_deadlines WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conference_settings WHERE conference_id = ?', [cid])
    // Every live scene action (submit, review, decide, register, check in,
    // certificates) triggers in-app notifications and queues an email log
    // row (even in EMAIL_MODE=console) - clean those up too or a re-seed
    // after recording hits a conferences FK violation.
    await pool.query('DELETE FROM notifications WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM email_logs WHERE conference_id = ?', [cid])
    await pool.query('DELETE FROM conferences WHERE id = ?', [cid])
  }
  if (allOwnedEmails.length > 0) {
    await pool.query(`DELETE FROM users WHERE email IN (${allOwnedEmails.map(() => '?').join(',')})`, allOwnedEmails)
  }

  // --- Conference ----------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO.password, BCRYPT_COST)

  await pool.query(
    `INSERT INTO conferences
       (slug, code, name, short_name, tagline, primary_color, country, timezone, status, start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?, 'NP', 'Asia/Kathmandu', 'published', DATE_ADD(CURDATE(), INTERVAL 14 DAY), DATE_ADD(CURDATE(), INTERVAL 16 DAY))`,
    [
      DEMO.conferenceSlug,
      DEMO.conferenceCode,
      DEMO.conferenceName,
      DEMO.conferenceShortName,
      'Where defenders gather.',
      COLOR.burgundy,
    ],
  )
  const [confRows2] = await pool.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [DEMO.conferenceSlug])
  const conferenceId = (confRows2 as Row[])[0]!.id as string

  await pool.query(
    'INSERT INTO conference_settings (conference_id, registration_requires_payment, default_currency) VALUES (?, FALSE, ?)',
    [conferenceId, 'USD'],
  )
  await pool.query(
    `INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at, closes_at)
     VALUES (?, 'registration', DATE_SUB(NOW(3), INTERVAL 10 DAY), DATE_ADD(NOW(3), INTERVAL 40 DAY))`,
    [conferenceId],
  )
  await pool.query(
    `INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at, closes_at)
     VALUES (?, 'abstract_submission', DATE_SUB(NOW(3), INTERVAL 10 DAY), DATE_ADD(NOW(3), INTERVAL 20 DAY))`,
    [conferenceId],
  )

  // Logo, generated with sharp, saved exactly like a real upload would be
  // (server/src/storage/fileStore.ts's `${folder}/${uuid}.${ext}` convention).
  // Written under server/storage-test-e2e/ (STORAGE_ROOT override below) -
  // the SAME throwaway storage directory the :4100 recording backend uses
  // (see docs/phase4-test-steps.md's e2e setup) - never server/storage,
  // which is the real local dev server's storage.
  const storagePublicDir = path.join(__dirname, '../server', process.env.STORAGE_ROOT ?? 'storage-test-e2e', 'public')
  const logoFolder = `conferences/${conferenceId}`
  const logoRelPath = `${logoFolder}/${randomBytes(8).toString('hex')}.png`
  await mkdir(path.join(storagePublicDir, logoFolder), { recursive: true })
  await writeFile(path.join(storagePublicDir, logoRelPath), await svgToPng(buildLogoSvg(), 512, 512))
  await pool.query('UPDATE conferences SET logo_path = ? WHERE id = ?', [logoRelPath, conferenceId])

  // --- Tracks ----------------------------------------------------------------
  const trackIds: string[] = []
  for (const name of DEMO.trackNames) {
    await pool.query('INSERT INTO conference_tracks (conference_id, name, is_active) VALUES (?, ?, TRUE)', [
      conferenceId,
      name,
    ])
    const [rows] = await pool.query('SELECT id FROM conference_tracks WHERE conference_id = ? AND name = ?', [
      conferenceId,
      name,
    ])
    trackIds.push((rows as Row[])[0]!.id as string)
  }

  // --- Users -----------------------------------------------------------------
  async function createUser(email: string, fullName: string, phone: string): Promise<string> {
    await pool.query('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
      email,
      passwordHash,
      fullName,
      phone,
    ])
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    return (rows as Row[])[0]!.id as string
  }

  async function addApprovedRole(userId: string, roleCode: string, reviewedBy: string): Promise<void> {
    await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, ?)`, [
      conferenceId,
      userId,
      roleCode,
    ])
    await pool.query(
      `INSERT INTO role_requests (user_id, conference_id, role_code, status, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, 'approved', ?, NOW(3))`,
      [userId, conferenceId, roleCode, reviewedBy],
    )
  }

  const adminId = await createUser(DEMO.adminEmail, 'Demo Admin', '+9779811000001')
  await pool.query('INSERT INTO platform_user_roles (user_id, role_code) VALUES (?, ?)', [adminId, 'admin'])

  const convenorId = await createUser(DEMO.convenorEmail, 'Demo Convenor', '+9779811000002')
  await pool.query(`INSERT INTO conference_members (conference_id, user_id, role_code) VALUES (?, ?, 'convenor')`, [
    conferenceId,
    convenorId,
  ])

  const authorId = await createUser(DEMO.authorEmail, 'Demo Author', '+9779811000003')
  await addApprovedRole(authorId, 'author', convenorId)

  const reviewerId = await createUser(DEMO.reviewerEmail, 'Demo Reviewer', '+9779811000004')
  await addApprovedRole(reviewerId, 'reviewer', convenorId)
  for (const trackId of trackIds) {
    await pool.query('INSERT INTO reviewer_tracks (conference_id, user_id, track_id) VALUES (?, ?, ?)', [
      conferenceId,
      reviewerId,
      trackId,
    ])
  }

  const staffId = await createUser(DEMO.staffEmail, 'Demo Staff', '+9779811000005')
  await addApprovedRole(staffId, 'staff', convenorId)

  // Scene 9 registers this persona live - no registration row yet. They DO
  // need one approved conference role to pass the /login role gate at all
  // (verifyLogin requires an approved role_requests row for any non-convenor
  // role - "attendee" itself is a derived role, never a conference_members
  // row, so a pure-attendee account with zero roles cannot sign in through
  // the normal login form). "author" is the least narratively distracting
  // choice - the recording signs in picking "Author" then navigates straight
  // to My ticket, never touching My submissions.
  const attendeeId = await createUser(DEMO.attendeeEmail, 'Demo Attendee', '+9779811000006')
  await addApprovedRole(attendeeId, 'author', convenorId)

  // --- Submissions -------------------------------------------------------
  async function createSubmission(title: string, abstract: string, status: string, trackId: string): Promise<string> {
    await pool.query(
      `INSERT INTO submissions (conference_id, track_id, title, abstract, status, created_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
      [conferenceId, trackId, title, abstract, status, authorId],
    )
    const [rows] = await pool.query(
      'SELECT id FROM submissions WHERE conference_id = ? AND title = ? ORDER BY created_at DESC LIMIT 1',
      [conferenceId, title],
    )
    const submissionId = (rows as Row[])[0]!.id as string
    await pool.query(
      `INSERT INTO submission_authors (submission_id, user_id, author_order, full_name, email, is_corresponding)
       VALUES (?, ?, 1, 'Demo Author', ?, TRUE)`,
      [submissionId, authorId, DEMO.authorEmail],
    )
    return submissionId
  }

  // P1 - already accepted: shows up in the author's own submission list, and
  // is what scene 7 schedules live into the programme.
  const acceptedPaperId = await createSubmission(
    DEMO.acceptedPaperTitle,
    'A zero-trust segmentation approach for SCADA/OT networks, evaluated against three industrial testbeds.',
    'accepted',
    trackIds[0]!,
  )

  // P2 - under review, unreviewed assignment: scene 5 (reviewer opens it and
  // submits a review, live).
  const underReviewPaperId = await createSubmission(
    DEMO.underReviewPaperTitle,
    'We evaluate the robustness of five intrusion-detection model families against gradient-based adversarial perturbation.',
    'under_review',
    trackIds[1]!,
  )
  await pool.query(
    `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, assigned_by, due_at)
     VALUES (?, ?, ?, 1, 'assigned', ?, DATE_ADD(NOW(3), INTERVAL 14 DAY))`,
    [conferenceId, underReviewPaperId, reviewerId, convenorId],
  )

  // P3 - under review, with ONE already-completed review (seeded directly,
  // not live-authored): scene 6 (convenor opens it and accepts, live) is
  // re-recordable on its own without needing scene 5 to have just run.
  // Same track as session 2 ("Cyber Security Research Papers I", below) -
  // the "add a paper to this session" dropdown filters candidates by the
  // session's track, so scene 7 can only schedule a paper that matches it.
  const readyToDecidePaperId = await createSubmission(
    DEMO.readyToDecidePaperTitle,
    'A federated learning scheme for sharing threat-intelligence signals across organisations without centralising raw telemetry.',
    'under_review',
    trackIds[0]!,
  )
  await pool.query(
    `INSERT INTO review_assignments
       (conference_id, submission_id, reviewer_id, round, status, assigned_by, due_at, responded_at, completed_at)
     VALUES (?, ?, ?, 1, 'completed', ?, DATE_ADD(NOW(3), INTERVAL 14 DAY), NOW(3), NOW(3))`,
    [conferenceId, readyToDecidePaperId, reviewerId, convenorId],
  )
  const [raRows] = await pool.query(
    'SELECT id FROM review_assignments WHERE submission_id = ? AND reviewer_id = ? LIMIT 1',
    [readyToDecidePaperId, reviewerId],
  )
  const readyAssignmentId = (raRows as Row[])[0]!.id as string
  await pool.query(
    `INSERT INTO reviews
       (assignment_id, originality, quality, relevance, methodology, overall_score, confidence,
        recommendation, comments_to_author, status, submitted_at)
     VALUES (?, 4, 4, 5, 4, 4, 4, 'accept', 'Solid contribution with a clear, reproducible methodology.', 'submitted', NOW(3))`,
    [readyAssignmentId],
  )

  // --- Programme: rooms, slots, 2 published sessions ----------------------
  await pool.query(`INSERT INTO rooms (conference_id, name, capacity) VALUES (?, 'Main Hall', 300)`, [conferenceId])
  const [mainHallRows] = await pool.query('SELECT id FROM rooms WHERE conference_id = ? AND name = ?', [
    conferenceId,
    'Main Hall',
  ])
  const mainHallId = (mainHallRows as Row[])[0]!.id as string

  await pool.query(`INSERT INTO rooms (conference_id, name, capacity) VALUES (?, 'Seminar Room 1', 60)`, [conferenceId])
  const [seminarRows] = await pool.query('SELECT id FROM rooms WHERE conference_id = ? AND name = ?', [
    conferenceId,
    'Seminar Room 1',
  ])
  const seminarRoomId = (seminarRows as Row[])[0]!.id as string

  await pool.query(
    `INSERT INTO schedule_slots (conference_id, label, starts_at, ends_at)
     VALUES (?, 'Day 1 - Morning', DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 9 HOUR, DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 10.5 HOUR)`,
    [conferenceId],
  )
  const [slotARows] = await pool.query(
    "SELECT id FROM schedule_slots WHERE conference_id = ? AND label = 'Day 1 - Morning'",
    [conferenceId],
  )
  const slotAId = (slotARows as Row[])[0]!.id as string

  await pool.query(
    `INSERT INTO schedule_slots (conference_id, label, starts_at, ends_at)
     VALUES (?, 'Day 1 - Afternoon', DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 13 HOUR, DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 14.5 HOUR)`,
    [conferenceId],
  )
  const [slotBRows] = await pool.query(
    "SELECT id FROM schedule_slots WHERE conference_id = ? AND label = 'Day 1 - Afternoon'",
    [conferenceId],
  )
  const slotBId = (slotBRows as Row[])[0]!.id as string

  // Session 1: keynote, with a filler presentation already in it (so scene
  // 2's public programme view isn't empty before any live action happens).
  await pool.query(
    `INSERT INTO conference_sessions
       (conference_id, room_id, slot_id, title, session_type, starts_at, ends_at, status)
     VALUES (?, ?, ?, 'Opening Keynote: The Future of Cyber Defence', 'keynote',
             DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 9 HOUR, DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 10.5 HOUR,
             'published')`,
    [conferenceId, mainHallId, slotAId],
  )
  const [keynoteSessionRows] = await pool.query(
    "SELECT id FROM conference_sessions WHERE conference_id = ? AND title = 'Opening Keynote: The Future of Cyber Defence'",
    [conferenceId],
  )
  const keynoteSessionId = (keynoteSessionRows as Row[])[0]!.id as string

  await pool.query(
    `INSERT INTO conference_speakers (conference_id, full_name, designation, affiliation, speaker_type, is_public)
     VALUES (?, 'Dr. Elena Cross', 'Chief Information Security Officer', 'Northbridge Financial Group', 'keynote', TRUE)`,
    [conferenceId],
  )
  const [speakerRows] = await pool.query(
    "SELECT id FROM conference_speakers WHERE conference_id = ? AND full_name = 'Dr. Elena Cross'",
    [conferenceId],
  )
  const speakerId = (speakerRows as Row[])[0]!.id as string
  await pool.query(
    `INSERT INTO presentations
       (conference_id, session_id, speaker_id, title, starts_at, ends_at, presentation_order, status)
     VALUES (?, ?, ?, 'The Future of Cyber Defence', DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 9 HOUR,
             DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 10.5 HOUR, 1, 'scheduled')`,
    [conferenceId, keynoteSessionId, speakerId],
  )

  // Session 2: paper session, deliberately left EMPTY - scene 7 schedules
  // the newly-accepted paper (P1) into it, live.
  await pool.query(
    `INSERT INTO conference_sessions
       (conference_id, room_id, track_id, slot_id, title, session_type, starts_at, ends_at, status)
     VALUES (?, ?, ?, ?, 'Cyber Security Research Papers I', 'paper',
             DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 13 HOUR, DATE_ADD(CURDATE(), INTERVAL 14 DAY) + INTERVAL 14.5 HOUR,
             'published')`,
    [conferenceId, seminarRoomId, trackIds[0]!, slotBId],
  )

  // --- Registration: one category, 15 fake registrations (some checked in) --
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General Attendee')`,
    [conferenceId],
  )
  const [catRows] = await pool.query(
    "SELECT id FROM registration_categories WHERE conference_id = ? AND code = 'general'",
    [conferenceId],
  )
  const categoryId = (catRows as Row[])[0]!.id as string

  for (let i = 1; i <= DEMO.fakeAttendeeCount; i += 1) {
    const email = fakeAttendeeEmail(i)
    const userId = await createUser(email, `Demo Fake Attendee ${i}`, `+97798110010${String(i).padStart(2, '0')}`)
    const qrToken = randomBytes(24).toString('hex')
    const registrationNumber = `${DEMO.conferenceShortName}-R-${String(i).padStart(4, '0')}`
    await pool.query(
      `INSERT INTO registrations
         (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token)
       VALUES (?, ?, ?, ?, 'confirmed', 0.00, 'USD', ?)`,
      [conferenceId, userId, categoryId, registrationNumber, qrToken],
    )
    if (i <= DEMO.fakeAttendeeCheckedInCount) {
      const [regRows] = await pool.query('SELECT id FROM registrations WHERE registration_number = ?', [
        registrationNumber,
      ])
      const registrationId = (regRows as Row[])[0]!.id as string
      await pool.query(
        `INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date, method, checked_in_by)
         VALUES (?, ?, ?, CURDATE(), 'manual', ?)`,
        [conferenceId, registrationId, userId, staffId],
      )
    }
  }

  // --- Certificate template: one active, with background + signature -----
  await pool.query(
    `INSERT INTO certificate_templates (conference_id, certificate_type, name, layout, signatories, is_active)
     VALUES (?, 'participation', 'Participation certificate',
             JSON_OBJECT('name', JSON_OBJECT('y', 260, 'font_size', 48, 'color', '#1A1A1A')),
             JSON_ARRAY(JSON_OBJECT('name', 'Demo Convenor', 'title', 'Conference Convenor', 'signature_path', NULL)),
             TRUE)`,
    [conferenceId],
  )
  const [templateRows] = await pool.query(
    "SELECT id FROM certificate_templates WHERE conference_id = ? AND certificate_type = 'participation' LIMIT 1",
    [conferenceId],
  )
  const templateId = (templateRows as Row[])[0]!.id as string

  const certFolder = `certificates/${conferenceId}`
  const certSigFolder = `${certFolder}/signatures`
  const backgroundRelPath = `${certFolder}/${randomBytes(8).toString('hex')}.png`
  const signatureRelPath = `${certSigFolder}/${randomBytes(8).toString('hex')}.png`
  await mkdir(path.join(storagePublicDir, certFolder), { recursive: true })
  await mkdir(path.join(storagePublicDir, certSigFolder), { recursive: true })
  await writeFile(path.join(storagePublicDir, backgroundRelPath), await svgToPng(buildCertificateBackgroundSvg(), 1684, 1190))
  await writeFile(path.join(storagePublicDir, signatureRelPath), await svgToPng(buildSignatureSvg(), 420, 160))

  await pool.query('UPDATE certificate_templates SET background_path = ? WHERE id = ?', [backgroundRelPath, templateId])
  await pool.query(
    `UPDATE certificate_templates SET signatories = JSON_SET(signatories, '$[0].signature_path', ?) WHERE id = ?`,
    [signatureRelPath, templateId],
  )

  // --- Report ---------------------------------------------------------------
  console.log(`Demo fixtures seeded in ${connectedDb}:`)
  console.log(`  conference: ${DEMO.conferenceSlug} (${conferenceId})`)
  console.log(`  password for every demo account: "${DEMO.password}" (from demo-video/.env.demo, or the default)`)
  console.log(`  admin:     ${DEMO.adminEmail}`)
  console.log(`  convenor:  ${DEMO.convenorEmail}`)
  console.log(`  author:    ${DEMO.authorEmail}  (accepted: "${DEMO.acceptedPaperTitle}")`)
  console.log(`  reviewer:  ${DEMO.reviewerEmail}`)
  console.log(`  staff:     ${DEMO.staffEmail}`)
  console.log(`  attendee:  ${DEMO.attendeeEmail}  (NOT registered yet - scene 9 does this live)`)
  console.log(`  papers:    P1 accepted=${acceptedPaperId}`)
  console.log(`             P2 under_review (unreviewed, for scene 5)=${underReviewPaperId}`)
  console.log(`             P3 under_review (1 completed review, for scene 6)=${readyToDecidePaperId}`)
  console.log(
    `  registrations: ${DEMO.fakeAttendeeCount} fake (${DEMO.fakeAttendeeCheckedInCount} checked in, ${DEMO.fakeAttendeeCount - DEMO.fakeAttendeeCheckedInCount} not)`,
  )
  console.log(`  certificate template: ${templateId} (background + signature image generated)`)

  await pool.end()
}

// Only run when executed directly (`npx tsx demo-seed.ts`) - record.ts
// imports the DEMO constant from this module without re-seeding on import.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  main().catch((err) => {
    console.error('Demo seed failed:', err)
    process.exit(1)
  })
}
