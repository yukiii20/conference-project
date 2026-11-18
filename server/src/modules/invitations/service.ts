import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { env, isProduction } from '../../config/env.js'
import { sendQueuedEmailNow, type EmailSendOutcome } from '../../email/worker.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { generateToken, sha256 } from '../../utils/crypto.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js'
import { notifyUser } from '../../utils/notifications.js'
import { conferenceSignInPath, conferenceSignInUrl } from '../../utils/conferenceLinks.js'
import { passwordSchema } from '../auth/validation.js'
import { findConference, hashPassword, recordFailedLogin, roleLabel, verifyPassword, type ConferenceRef } from '../auth/service.js'

/**
 * Conference invitations (FIXES.md problem 11).
 *
 * Inviting someone creates a PENDING row in conference_invitations - never an active
 * conference_members row - so a pending invitation gives no access at all: the person can't
 * sign in with that role or see the conference. The invitation email is always sent, to new
 * and existing accounts alike, with a single-use link that expires after 7 days. Accepting
 * (new account: choose a password; existing account: sign in) creates or reactivates the
 * membership and signs the person in at that conference. Declining, cancelling and expiry
 * leave no access behind.
 */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function invitationAcceptUrl(rawToken: string): string {
  return `${env.APP_URL}/invitations/accept?token=${rawToken}`
}

export type InvitationEmailResult = EmailSendOutcome & {
  /** Set when the server can't deliver email at all (so the convenor isn't told "sent" for an email nobody gets). */
  warning: string | null
}

function deliveryWarning(): string | null {
  return isProduction && env.EMAIL_MODE === 'console'
    ? 'Email sending is not set up on the server (EMAIL_MODE=console), so the invitation email was only written to the server log. Set up Brevo (EMAIL_MODE=brevo) to deliver it.'
    : null
}

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

/** Issues a fresh token on `invitationId` and queues the invitation email. Returns the email_logs id. */
async function issueTokenAndQueueEmail(
  conn: PoolConnection,
  invitation: { id: string; conference_id: string; user_id: string; email: string; role_code: string },
  inviterId: string,
): Promise<number> {
  const rawToken = generateToken()
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)

  const [infoRows] = await conn.query(
    `SELECT c.name AS conference_name, c.code AS conference_code, c.slug, u.full_name, inv.full_name AS inviter_name
     FROM conferences c
     JOIN users u ON u.id = ?
     LEFT JOIN users inv ON inv.id = ?
     WHERE c.id = ? LIMIT 1`,
    [invitation.user_id, inviterId, invitation.conference_id],
  )
  const info = (infoRows as Array<{ conference_name: string; conference_code: string; slug: string; full_name: string; inviter_name: string | null }>)[0]
  if (!info) throw new NotFoundError('This conference does not exist.')

  const data = {
    full_name: info.full_name,
    conference_name: info.conference_name,
    conference_code: info.conference_code,
    role_name: roleLabel(invitation.role_code),
    inviter_name: info.inviter_name ?? 'The organisers',
    accept_url: invitationAcceptUrl(rawToken),
    sign_in_url: conferenceSignInUrl(info.slug),
    expires_at: formatExpiry(expiresAt),
  }
  const [templateRows] = await conn.query(
    `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'member_invitation' LIMIT 1`,
  )
  const template = (templateRows as Array<{ subject: string }>)[0]
  const subject = template
    ? renderTemplate(template.subject, data)
    : `[${info.conference_code}] You are invited to ${info.conference_name} as ${data.role_name}`

  const emailLogId = await queueEmail(conn, {
    userId: invitation.user_id,
    conferenceId: invitation.conference_id,
    recipientEmail: invitation.email,
    templateKey: 'member_invitation',
    subject,
    templateData: data,
    entityType: 'conference_invitations',
    entityId: invitation.id,
  })
  await conn.query(
    `UPDATE conference_invitations SET token_hash = ?, expires_at = ?, email_log_id = ?, invited_by = ? WHERE id = ?`,
    [sha256(rawToken), expiresAt, emailLogId, inviterId, invitation.id],
  )
  return emailLogId
}

export type CreateInvitationInput = { email: string; full_name: string; phone: string; role_code: string }

/** Members tab "Invite member". Never creates a membership. */
export async function createInvitation(
  actorUserId: string,
  conferenceId: string,
  input: CreateInvitationInput,
  ctx: AuditContext = {},
): Promise<{ invitation_id: string; new_account: boolean; email: InvitationEmailResult }> {
  const { invitationId, emailLogId, newAccount } = await withTransaction(actorUserId, async (conn) => {
    const [confRows] = await conn.query('SELECT id FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [conferenceId])
    if ((confRows as unknown[]).length === 0) throw new NotFoundError('This conference does not exist.')

    const [existingRows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
    let userId = (existingRows as Array<{ id: string }>)[0]?.id
    const newAccount = !userId
    if (!userId) {
      // An account with no password yet: it can't sign in until the invitation is accepted.
      await conn.query('INSERT INTO users (email, full_name, phone) VALUES (?, ?, ?)', [input.email, input.full_name, input.phone])
      const [rows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
      userId = (rows as Array<{ id: string }>)[0]!.id
    }

    const [activeRows] = await conn.query(
      `SELECT 1 FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = ? AND status = 'active' LIMIT 1`,
      [conferenceId, userId, input.role_code],
    )
    if ((activeRows as unknown[]).length > 0) throw new BadRequestError('This person already has that role in this conference.')

    const [pendingRows] = await conn.query(
      `SELECT id FROM conference_invitations WHERE conference_id = ? AND user_id = ? AND role_code = ? AND status = 'pending' LIMIT 1 FOR UPDATE`,
      [conferenceId, userId, input.role_code],
    )
    if ((pendingRows as unknown[]).length > 0) {
      throw new AppError(409, 'This person has already been invited with that role. Use "Resend invitation" to send the email again.', undefined, 'invitation_pending')
    }

    const invitationId = crypto.randomUUID()
    // A placeholder hash (never handed out) until issueTokenAndQueueEmail sets the real one.
    await conn.query(
      `INSERT INTO conference_invitations (id, conference_id, user_id, email, role_code, token_hash, expires_at, invited_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [invitationId, conferenceId, userId, input.email, input.role_code, sha256(generateToken()), new Date(Date.now() + INVITATION_TTL_MS), actorUserId],
    )
    const emailLogId = await issueTokenAndQueueEmail(
      conn,
      { id: invitationId, conference_id: conferenceId, user_id: userId, email: input.email, role_code: input.role_code },
      actorUserId,
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'member.invite',
      entityType: 'conference_invitations',
      entityId: invitationId,
      newValues: { email: input.email, role_code: input.role_code, new_account: newAccount, user_id: userId },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
    return { invitationId, emailLogId, newAccount }
  })

  const outcome = await sendQueuedEmailNow(emailLogId)
  return { invitation_id: invitationId, new_account: newAccount, email: { ...outcome, warning: deliveryWarning() } }
}

export type InvitationRow = {
  id: string
  user_id: string
  email: string
  full_name: string
  role_code: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  expired: boolean
  expires_at: string
  created_at: string
  responded_at: string | null
  invited_by_name: string | null
  email_status: string | null
  email_error: string | null
}

/** Members tab: pending invitations first, then the most recent answered ones. */
export async function listInvitations(conferenceId: string): Promise<InvitationRow[]> {
  const [rows] = await pool.query(
    `SELECT i.id, i.user_id, i.email, u.full_name, i.role_code, i.status, (i.expires_at <= NOW(3)) AS expired,
            i.expires_at, i.created_at, i.responded_at, inv.full_name AS invited_by_name,
            e.status AS email_status, e.error_message AS email_error
     FROM conference_invitations i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN users inv ON inv.id = i.invited_by
     LEFT JOIN email_logs e ON e.id = i.email_log_id
     WHERE i.conference_id = ?
     ORDER BY i.status = 'pending' DESC, i.created_at DESC
     LIMIT 200`,
    [conferenceId],
  )
  return (rows as Array<InvitationRow & { expired: number | boolean }>).map((r) => ({ ...r, expired: Boolean(r.expired) }))
}

async function loadInvitationForUpdate(conn: PoolConnection, conferenceId: string, invitationId: string) {
  const [rows] = await conn.query(
    `SELECT id, conference_id, user_id, email, role_code, status FROM conference_invitations WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [invitationId, conferenceId],
  )
  const row = (rows as Array<{ id: string; conference_id: string; user_id: string; email: string; role_code: string; status: string }>)[0]
  if (!row) throw new NotFoundError('This invitation does not exist.')
  return row
}

/** New link (the old one stops working), new 7-day expiry, new email. */
export async function resendInvitation(
  actorUserId: string,
  conferenceId: string,
  invitationId: string,
  ctx: AuditContext = {},
): Promise<{ email: InvitationEmailResult }> {
  const emailLogId = await withTransaction(actorUserId, async (conn) => {
    const row = await loadInvitationForUpdate(conn, conferenceId, invitationId)
    if (row.status !== 'pending') throw new ConflictError(`This invitation was already ${row.status}. Invite the person again instead.`)
    const id = await issueTokenAndQueueEmail(conn, row, actorUserId)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'member.invitation_resend',
      entityType: 'conference_invitations',
      entityId: invitationId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
    return id
  })
  const outcome = await sendQueuedEmailNow(emailLogId)
  return { email: { ...outcome, warning: deliveryWarning() } }
}

export async function cancelInvitation(actorUserId: string, conferenceId: string, invitationId: string, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const row = await loadInvitationForUpdate(conn, conferenceId, invitationId)
    if (row.status !== 'pending') throw new ConflictError(`This invitation was already ${row.status}.`)
    await conn.query(`UPDATE conference_invitations SET status = 'cancelled', responded_at = NOW(3) WHERE id = ?`, [invitationId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'member.invitation_cancel',
      entityType: 'conference_invitations',
      entityId: invitationId,
      oldValues: { status: 'pending' },
      newValues: { status: 'cancelled' },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

// ---------------------------------------------------------------------------------- by token

type TokenRow = {
  id: string
  conference_id: string
  user_id: string
  email: string
  role_code: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  expires_at: Date
  invited_by: string | null
  inviter_name: string | null
  full_name: string
  password_hash: string | null
  user_status: string
  failed_login_count: number
  locked_until: Date | null
}

async function loadByToken(conn: PoolConnection | typeof pool, rawToken: string, forUpdate = false): Promise<TokenRow> {
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(rawToken)) throw invalidLink()
  const [rows] = await conn.query(
    `SELECT i.id, i.conference_id, i.user_id, i.email, i.role_code, i.status, i.expires_at, i.invited_by,
            inv.full_name AS inviter_name, u.full_name, u.password_hash, u.status AS user_status,
            u.failed_login_count, u.locked_until
     FROM conference_invitations i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN users inv ON inv.id = i.invited_by
     WHERE i.token_hash = ? LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [sha256(rawToken)],
  )
  const row = (rows as TokenRow[])[0]
  if (!row) throw invalidLink()
  return row
}

function invalidLink(): AppError {
  return new AppError(404, 'This invitation link is not valid. It may have been replaced by a newer invitation email.', undefined, 'invitation_invalid')
}

/** A link that was used, cancelled or expired never works again. */
function assertUsable(row: TokenRow): void {
  if (row.status === 'accepted') throw new AppError(410, 'This invitation has already been accepted. Sign in at the conference to continue.', undefined, 'invitation_used')
  if (row.status === 'declined') throw new AppError(410, 'This invitation was declined. Ask the organisers to invite you again.', undefined, 'invitation_used')
  if (row.status === 'cancelled') throw new AppError(410, 'The organisers cancelled this invitation.', undefined, 'invitation_cancelled')
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(410, 'This invitation has expired. Ask the organisers to send it again.', undefined, 'invitation_expired')
  }
}

async function conferenceFor(row: TokenRow): Promise<ConferenceRef> {
  const conference = await findConference(row.conference_id, { publishedOnly: false })
  if (!conference) throw new AppError(410, 'This conference is no longer available.', undefined, 'invitation_cancelled')
  return conference
}

export type PublicInvitation = {
  conference: { id: string; name: string; slug: string; logo_path: string | null; primary_color: string | null }
  role_code: string
  role_name: string
  inviter_name: string | null
  email: string
  full_name: string
  expires_at: string
  /** true: a brand-new account - the page asks for a new password. false: sign in with the existing one. */
  needs_password: boolean
}

/** GET /api/invitations/:token - what the accept screen shows. Reveals nothing for a bad token. */
export async function getInvitationByToken(rawToken: string): Promise<PublicInvitation> {
  const row = await loadByToken(pool, rawToken)
  assertUsable(row)
  const conference = await conferenceFor(row)
  return {
    conference: { id: conference.id, name: conference.name, slug: conference.slug, logo_path: conference.logo_path, primary_color: conference.primary_color },
    role_code: row.role_code,
    role_name: roleLabel(row.role_code),
    inviter_name: row.inviter_name,
    email: row.email,
    full_name: row.full_name,
    expires_at: new Date(row.expires_at).toISOString(),
    needs_password: !row.password_hash,
  }
}

/**
 * Accepts the invitation. Who may accept: a brand-new account sets its password here; an
 * existing account either is already signed in as that same person or signs in with its
 * password (same lockout as normal sign-in). Returns the conference to sign the person in at.
 */
export async function acceptInvitationByToken(
  rawToken: string,
  input: { password?: string; sessionUserId?: string | null },
  ctx: AuditContext = {},
): Promise<{ userId: string; conference: ConferenceRef }> {
  const preview = await loadByToken(pool, rawToken)
  assertUsable(preview)
  const conference = await conferenceFor(preview)
  if (preview.user_status !== 'active') throw new AppError(403, 'This account is not active. Contact the organisers.', undefined, 'account_inactive')

  let newPasswordHash: string | null = null
  if (!preview.password_hash) {
    if (!input.password) throw new BadRequestError('Choose a password to create your account.', { password: 'Choose a password.' })
    const strong = passwordSchema.safeParse(input.password)
    if (!strong.success) {
      const message = strong.error.issues[0]?.message ?? 'Choose a stronger password.'
      throw new BadRequestError(message, { password: message })
    }
    newPasswordHash = await hashPassword(input.password)
  } else if (input.sessionUserId !== preview.user_id) {
    const wrong = () =>
      new AppError(401, 'Sign in with the password of this account to accept.', { password: 'This password is not correct for this account.' }, 'sign_in_required')
    if (!input.password) throw wrong()
    if (preview.locked_until && new Date(preview.locked_until).getTime() > Date.now()) {
      throw new AppError(429, 'Too many wrong passwords. Try again later, or reset your password.', undefined, 'account_locked')
    }
    if (!(await verifyPassword(input.password, preview.password_hash))) {
      await recordFailedLogin(preview.user_id, preview.failed_login_count)
      throw wrong()
    }
  }

  await withTransaction(preview.user_id, async (conn) => {
    // Re-check under lock: two clicks on the link must not both succeed.
    const row = await loadByToken(conn, rawToken, true)
    assertUsable(row)
    if (newPasswordHash) {
      await conn.query('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash IS NULL', [newPasswordHash, row.user_id])
    }
    await conn.query(`UPDATE conference_invitations SET status = 'accepted', responded_at = NOW(3) WHERE id = ?`, [row.id])
    const [updated] = await conn.query(
      `UPDATE conference_members SET status = 'active' WHERE conference_id = ? AND user_id = ? AND role_code = ?`,
      [row.conference_id, row.user_id, row.role_code],
    )
    if ((updated as { affectedRows: number }).affectedRows === 0) {
      await conn.query(`INSERT INTO conference_members (conference_id, user_id, role_code, added_by) VALUES (?, ?, ?, ?)`, [
        row.conference_id,
        row.user_id,
        row.role_code,
        row.invited_by,
      ])
    }
    await insertAuditLog(conn, {
      actorUserId: row.user_id,
      conferenceId: row.conference_id,
      action: 'member.invitation_accept',
      entityType: 'conference_invitations',
      entityId: row.id,
      newValues: { role_code: row.role_code, set_password: Boolean(newPasswordHash) },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
    if (row.invited_by) {
      await notifyUser(conn, {
        userId: row.invited_by,
        conferenceId: row.conference_id,
        type: 'system',
        title: 'Invitation accepted',
        body: `${row.full_name} accepted your invitation as ${roleLabel(row.role_code)}.`,
      })
    }
  })
  return { userId: preview.user_id, conference }
}

/** Declining needs only the link (it proves the email reached this person). */
export async function declineInvitationByToken(rawToken: string, ctx: AuditContext = {}): Promise<{ conference_slug: string }> {
  const preview = await loadByToken(pool, rawToken)
  assertUsable(preview)
  const conference = await conferenceFor(preview)
  await withTransaction(preview.user_id, async (conn) => {
    const row = await loadByToken(conn, rawToken, true)
    assertUsable(row)
    await conn.query(`UPDATE conference_invitations SET status = 'declined', responded_at = NOW(3) WHERE id = ?`, [row.id])
    await insertAuditLog(conn, {
      actorUserId: row.user_id,
      conferenceId: row.conference_id,
      action: 'member.invitation_decline',
      entityType: 'conference_invitations',
      entityId: row.id,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
    if (row.invited_by) {
      await notifyUser(conn, {
        userId: row.invited_by,
        conferenceId: row.conference_id,
        type: 'system',
        title: 'Invitation declined',
        body: `${row.full_name} declined the invitation as ${roleLabel(row.role_code)}.`,
        linkPath: conferenceSignInPath(conference.slug),
      })
    }
  })
  return { conference_slug: conference.slug }
}
