import sharp from 'sharp'
import { pool } from '../src/db/pool.js'
import { hashPassword } from '../src/modules/auth/service.js'
import { generateToken, sha256 } from '../src/utils/crypto.js'

export async function pngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer()
}

export async function jpgBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .jpeg()
    .toBuffer()
}

export function pdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')
}

export function exeBuffer(): Buffer {
  return Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0)])
}

export function oversizedBuffer(bytes: number): Buffer {
  return Buffer.alloc(bytes, 1)
}

/**
 * Wipes every row this phase's tests can create, in FK-safe order (children
 * before parents). Deliberately leaves audit_logs alone — its triggers block
 * DELETE unconditionally, by design (see database/03_triggers.sql) — and
 * leaves reference data (roles, permissions, deadline_types, email_templates)
 * alone since those come from 02_reference_data.sql, not from tests.
 */
export async function resetDatabase(): Promise<void> {
  await pool.query('DELETE FROM platform_settings')
  await pool.query('DELETE FROM notifications')
  await pool.query('DELETE FROM email_logs')
  // Conference-specific template overrides only — never the platform defaults (conference_id IS NULL) from 02_reference_data.sql.
  await pool.query('DELETE FROM email_templates WHERE conference_id IS NOT NULL')
  await pool.query('DELETE FROM announcements')
  await pool.query('DELETE FROM committee_members')
  await pool.query('DELETE FROM committees')
  await pool.query('DELETE FROM presentations')
  await pool.query('DELETE FROM session_chairs')
  await pool.query('DELETE FROM conference_speakers')
  await pool.query('DELETE FROM reviews')
  await pool.query('DELETE FROM review_assignments')
  await pool.query('DELETE FROM reviewer_tracks')
  await pool.query('DELETE FROM conflicts_of_interest')
  await pool.query('DELETE FROM submission_decisions')
  await pool.query('DELETE FROM submission_status_history')
  await pool.query('DELETE FROM submission_files')
  await pool.query('DELETE FROM submission_authors')
  await pool.query('DELETE FROM submissions')
  await pool.query('DELETE FROM conference_counters')
  await pool.query('DELETE FROM role_requests')
  await pool.query('DELETE FROM conference_members')
  await pool.query('DELETE FROM conference_deadlines')
  await pool.query('DELETE FROM conference_settings')
  await pool.query('DELETE FROM conference_sessions')
  await pool.query('DELETE FROM schedule_slots')
  await pool.query('DELETE FROM rooms')
  await pool.query('DELETE FROM conference_tracks')
  await pool.query('DELETE FROM conference_supporters')
  await pool.query('DELETE FROM conferences')
  await pool.query('DELETE FROM auth_tokens')
  await pool.query('DELETE FROM auth_sessions')
  await pool.query('DELETE FROM users')
}

export async function createUser(input: {
  email: string
  password: string
  fullName?: string
  phone?: string
  status?: 'active' | 'suspended' | 'deactivated'
}): Promise<string> {
  const passwordHash = await hashPassword(input.password)
  await pool.query('INSERT INTO users (email, password_hash, full_name, phone, status) VALUES (?, ?, ?, ?, ?)', [
    input.email,
    passwordHash,
    input.fullName ?? 'Test User',
    input.phone ?? '+9779812345678',
    input.status ?? 'active',
  ])
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
  return (rows as Array<{ id: string }>)[0]!.id
}

/**
 * Creates a session row directly (bypassing POST /api/auth/login, which is
 * rate-limited to 20 attempts / 15 min and shared across every test in a
 * file). Returns the raw cookie value — requireAuth only ever checks the
 * session row, so this is indistinguishable from a real login.
 */
export async function createDirectSession(userId: string): Promise<string> {
  const token = generateToken()
  await pool.query(`INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 12 HOUR))`, [
    userId,
    sha256(token),
  ])
  return `cms_session=${token}`
}

export async function makePlatformAdmin(userId: string): Promise<void> {
  await pool.query('INSERT INTO platform_user_roles (user_id, role_code) VALUES (?, ?)', [userId, 'admin'])
}

export async function createConference(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 8)
  const slug = (overrides.slug as string) ?? `test-conf-${suffix}`
  const code = (overrides.code as string) ?? `TC${suffix}`.toUpperCase().slice(0, 10)
  await pool.query(
    `INSERT INTO conferences (slug, code, name, start_date, end_date, status, social_links)
     VALUES (?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), ?, JSON_OBJECT())`,
    [slug, code, (overrides.name as string) ?? 'Test Conference', (overrides.status as string) ?? 'submission_open'],
  )
  const [rows] = await pool.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [slug])
  return (rows as Array<{ id: string }>)[0]!.id
}

export async function addConferenceMember(
  conferenceId: string,
  userId: string,
  roleCode: string,
  status: 'active' | 'removed' = 'active',
): Promise<void> {
  await pool.query(
    `INSERT INTO conference_members (conference_id, user_id, role_code, status) VALUES (?, ?, ?, ?)`,
    [conferenceId, userId, roleCode, status],
  )
}

/**
 * Inserts an invitation token directly (bypassing the invite-convenor
 * service), so tests can exercise accept-invitation without needing to
 * intercept the console-logged link, and can test expiry without mocking
 * time.
 */
export async function createInvitationToken(userId: string, opts: { expired?: boolean } = {}): Promise<string> {
  const rawToken = generateToken()
  const interval = opts.expired ? 'DATE_SUB(NOW(3), INTERVAL 1 HOUR)' : 'DATE_ADD(NOW(3), INTERVAL 7 DAY)'
  await pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'invitation', ?, ${interval})`,
    [userId, sha256(rawToken)],
  )
  return rawToken
}

/** A user created with no password yet, as the convenor-invite endpoint creates one. */
export async function createPendingInviteUser(input: {
  email: string
  fullName?: string
  phone?: string
}): Promise<string> {
  await pool.query('INSERT INTO users (email, full_name, phone) VALUES (?, ?, ?)', [
    input.email,
    input.fullName ?? 'Invited User',
    input.phone ?? '+9779812345679',
  ])
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
  return (rows as Array<{ id: string }>)[0]!.id
}

/**
 * Inserts a submission directly at whatever status the test needs (the
 * status-transition trigger only guards UPDATE, not INSERT) — far simpler
 * than driving it through the full author -> review -> decision flow when a
 * test (e.g. programme scheduling) only cares that an accepted paper exists.
 */
export async function createSubmission(
  conferenceId: string,
  trackId: string,
  createdByUserId: string,
  overrides: Partial<{ title: string; status: string }> = {},
): Promise<string> {
  const title = overrides.title ?? 'Test Submission'
  await pool.query(
    `INSERT INTO submissions (conference_id, track_id, title, abstract, status, created_by)
     VALUES (?, ?, ?, 'Test abstract text.', ?, ?)`,
    [conferenceId, trackId, title, overrides.status ?? 'accepted', createdByUserId],
  )
  const [rows] = await pool.query(
    'SELECT id FROM submissions WHERE conference_id = ? AND title = ? ORDER BY created_at DESC LIMIT 1',
    [conferenceId, title],
  )
  return (rows as Array<{ id: string }>)[0]!.id
}

export async function addSubmissionAuthor(
  submissionId: string,
  input: { fullName: string; email: string; userId?: string; isCorresponding?: boolean; order?: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO submission_authors (submission_id, user_id, author_order, full_name, email, is_corresponding)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [submissionId, input.userId ?? null, input.order ?? 1, input.fullName, input.email, input.isCorresponding ?? true],
  )
}

export async function createTrack(conferenceId: string, name: string, isActive = true): Promise<string> {
  await pool.query(
    `INSERT INTO conference_tracks (conference_id, name, is_active) VALUES (?, ?, ?)`,
    [conferenceId, name, isActive],
  )
  const [rows] = await pool.query('SELECT id FROM conference_tracks WHERE conference_id = ? AND name = ? LIMIT 1', [
    conferenceId,
    name,
  ])
  return (rows as Array<{ id: string }>)[0]!.id
}

export async function upsertConferenceSettings(
  conferenceId: string,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<void> {
  const defaults = {
    review_mode: 'double_blind',
    reviews_required: 3,
    max_submissions_per_author: null,
    max_abstract_words: 300,
    max_file_size_mb: 20,
    authors_see_review_comments: true,
  }
  const merged = { ...defaults, ...overrides }
  await pool.query(
    `INSERT INTO conference_settings
       (conference_id, review_mode, reviews_required, max_submissions_per_author, max_abstract_words, max_file_size_mb, authors_see_review_comments)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE review_mode = VALUES(review_mode), reviews_required = VALUES(reviews_required),
       max_submissions_per_author = VALUES(max_submissions_per_author), max_abstract_words = VALUES(max_abstract_words),
       max_file_size_mb = VALUES(max_file_size_mb), authors_see_review_comments = VALUES(authors_see_review_comments)`,
    [
      conferenceId,
      merged.review_mode,
      merged.reviews_required,
      merged.max_submissions_per_author,
      merged.max_abstract_words,
      merged.max_file_size_mb,
      merged.authors_see_review_comments,
    ],
  )
}

/** Sets a conference_deadlines window. Pass offsets in hours relative to now (negative = already open/past). */
export async function setDeadlineWindow(
  conferenceId: string,
  deadlineType: string,
  opensInHours: number,
  closesInHours: number | null,
): Promise<void> {
  const opensAt = new Date(Date.now() + opensInHours * 3_600_000)
  const closesAt = closesInHours === null ? null : new Date(Date.now() + closesInHours * 3_600_000)
  await pool.query(
    `INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at, closes_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE opens_at = VALUES(opens_at), closes_at = VALUES(closes_at)`,
    [conferenceId, deadlineType, opensAt, closesAt],
  )
}

export async function addReviewerTrack(conferenceId: string, userId: string, trackId: string): Promise<void> {
  await pool.query(`INSERT INTO reviewer_tracks (conference_id, user_id, track_id) VALUES (?, ?, ?)`, [
    conferenceId,
    userId,
    trackId,
  ])
}

export async function createRoleRequest(
  userId: string,
  conferenceId: string,
  roleCode: string,
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' = 'pending',
): Promise<string> {
  await pool.query(`INSERT INTO role_requests (user_id, conference_id, role_code, status) VALUES (?, ?, ?, ?)`, [
    userId,
    conferenceId,
    roleCode,
    status,
  ])
  const [rows] = await pool.query(
    'SELECT id FROM role_requests WHERE user_id = ? AND conference_id = ? AND role_code = ? LIMIT 1',
    [userId, conferenceId, roleCode],
  )
  return (rows as Array<{ id: string }>)[0]!.id
}
