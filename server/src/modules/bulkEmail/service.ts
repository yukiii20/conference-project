import type { Pool, PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { env } from '../../config/env.js'
import { insertAuditLog } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import { renderHtmlTemplate } from '../../email/render.js'
import { wrapEmailHtml } from '../../email/layout.js'
import { sanitizeTemplateHtml } from '../emailTemplates/service.js'
import type { PreviewContentInput, RecipientGroup, SaveDraftInput } from './validation.js'

type Queryable = Pool | PoolConnection

/** Brevo's free-tier cap (see docs/features-batch-1.md). Approximate: counts every queued/sending/sent row today regardless of EMAIL_MODE, which is conservative in dev (console/smtp modes don't actually touch Brevo) and accurate in production. */
const BREVO_DAILY_LIMIT = 300

type RecipientRow = { user_id: string | null; email: string; full_name: string }

// Each query returns the same three columns so results from any combination
// of groups can be merged in JS without per-group special-casing. Every
// group excludes deactivated/anonymised accounts (the spec's "exclude
// anonymised/deactivated users") — authors with no account (user_id NULL)
// have nothing to exclude, since they were never anonymisable.
const GROUP_QUERIES: Record<RecipientGroup, string> = {
  all_authors: `
    SELECT sa.user_id AS user_id, sa.email AS email, sa.full_name AS full_name
    FROM submission_authors sa
    JOIN submissions s ON s.id = sa.submission_id
    LEFT JOIN users u ON u.id = sa.user_id
    WHERE s.conference_id = ? AND s.deleted_at IS NULL
      AND (u.id IS NULL OR (u.status <> 'deactivated' AND u.anonymized_at IS NULL))`,
  authors_accepted: `
    SELECT sa.user_id AS user_id, sa.email AS email, sa.full_name AS full_name
    FROM submission_authors sa
    JOIN submissions s ON s.id = sa.submission_id
    LEFT JOIN users u ON u.id = sa.user_id
    WHERE s.conference_id = ? AND s.deleted_at IS NULL
      AND s.status IN ('accepted','full_paper_pending','full_paper_submitted','final_approved','scheduled','presented','completed')
      AND (u.id IS NULL OR (u.status <> 'deactivated' AND u.anonymized_at IS NULL))`,
  authors_rejected: `
    SELECT sa.user_id AS user_id, sa.email AS email, sa.full_name AS full_name
    FROM submission_authors sa
    JOIN submissions s ON s.id = sa.submission_id
    LEFT JOIN users u ON u.id = sa.user_id
    WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status = 'rejected'
      AND (u.id IS NULL OR (u.status <> 'deactivated' AND u.anonymized_at IS NULL))`,
  reviewers: `
    SELECT u.id AS user_id, u.email AS email, u.full_name AS full_name
    FROM conference_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conference_id = ? AND cm.status = 'active' AND cm.role_code = 'reviewer'
      AND u.status <> 'deactivated' AND u.anonymized_at IS NULL`,
  reviewers_pending: `
    SELECT DISTINCT u.id AS user_id, u.email AS email, u.full_name AS full_name
    FROM review_assignments ra
    JOIN users u ON u.id = ra.reviewer_id
    WHERE ra.conference_id = ? AND ra.status IN ('assigned','in_progress')
      AND u.status <> 'deactivated' AND u.anonymized_at IS NULL`,
  attendees_registered: `
    SELECT DISTINCT u.id AS user_id, u.email AS email, u.full_name AS full_name
    FROM registrations r
    JOIN users u ON u.id = r.user_id
    WHERE r.conference_id = ? AND r.status <> 'cancelled'
      AND u.status <> 'deactivated' AND u.anonymized_at IS NULL`,
  attendees_confirmed: `
    SELECT DISTINCT u.id AS user_id, u.email AS email, u.full_name AS full_name
    FROM registrations r
    JOIN users u ON u.id = r.user_id
    WHERE r.conference_id = ? AND r.status = 'confirmed'
      AND u.status <> 'deactivated' AND u.anonymized_at IS NULL`,
  attendees_checked_in: `
    SELECT DISTINCT u.id AS user_id, u.email AS email, u.full_name AS full_name
    FROM conference_attendance ca
    JOIN users u ON u.id = ca.user_id
    WHERE ca.conference_id = ?
      AND u.status <> 'deactivated' AND u.anonymized_at IS NULL`,
  committee_members: `
    SELECT DISTINCT u.id AS user_id, u.email AS email, u.full_name AS full_name
    FROM committee_members cmem
    JOIN committees c ON c.id = cmem.committee_id
    JOIN users u ON u.id = cmem.user_id
    WHERE c.conference_id = ? AND cmem.user_id IS NOT NULL
      AND u.status <> 'deactivated' AND u.anonymized_at IS NULL`,
  session_chairs: `
    SELECT u.id AS user_id, u.email AS email, u.full_name AS full_name
    FROM conference_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conference_id = ? AND cm.status = 'active' AND cm.role_code = 'session_chair'
      AND u.status <> 'deactivated' AND u.anonymized_at IS NULL`,
}

/** Runs every selected group's query and merges the results, de-duplicated by email (case-insensitive — same rule the `users` table itself uses). A row with a linked account wins over one without, if the same address shows up both ways (e.g. an author who later registered). */
async function resolveRecipients(queryable: Queryable, conferenceId: string, groups: RecipientGroup[]): Promise<RecipientRow[]> {
  const byEmail = new Map<string, RecipientRow>()
  for (const group of groups) {
    const [rows] = await queryable.query(GROUP_QUERIES[group], [conferenceId])
    for (const row of rows as RecipientRow[]) {
      const key = row.email.toLowerCase()
      const existing = byEmail.get(key)
      if (!existing || (!existing.user_id && row.user_id)) byEmail.set(key, row)
    }
  }
  return [...byEmail.values()]
}

async function getEmailQuota(queryable: Queryable): Promise<{ dailyLimit: number; usedToday: number; remainingToday: number }> {
  const [rows] = await queryable.query(
    `SELECT COUNT(*) AS c FROM email_logs WHERE status IN ('queued','sending','sent') AND queued_at >= UTC_DATE()`,
  )
  const usedToday = Number((rows as Array<{ c: number }>)[0]?.c ?? 0)
  return { dailyLimit: BREVO_DAILY_LIMIT, usedToday, remainingToday: Math.max(0, BREVO_DAILY_LIMIT - usedToday) }
}

async function loadConference(queryable: Queryable, conferenceId: string): Promise<{ name: string; slug: string }> {
  const [rows] = await queryable.query('SELECT name, slug FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
    conferenceId,
  ])
  const conference = (rows as Array<{ name: string; slug: string }>)[0]
  if (!conference) throw new NotFoundError('This conference does not exist.')
  return conference
}

function conferenceUrl(slug: string): string {
  return `${env.APP_URL}/c/${slug}`
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

function parseGroups(value: unknown): RecipientGroup[] {
  return (typeof value === 'string' ? JSON.parse(value) : value) as RecipientGroup[]
}

export async function previewRecipients(
  conferenceId: string,
  groups: RecipientGroup[],
): Promise<{ count: number; preview: Array<{ name: string; email: string }>; daily_limit: number; used_today: number; remaining_today: number }> {
  const recipients = await resolveRecipients(pool, conferenceId, groups)
  const quota = await getEmailQuota(pool)
  return {
    count: recipients.length,
    preview: recipients.slice(0, 25).map((r) => ({ name: r.full_name, email: r.email })),
    daily_limit: quota.dailyLimit,
    used_today: quota.usedToday,
    remaining_today: quota.remainingToday,
  }
}

const SAMPLE_RECIPIENT = { first_name: 'Jordan', full_name: 'Jordan Lee' }

export async function previewContent(conferenceId: string, input: PreviewContentInput): Promise<{ subject: string; html: string }> {
  const conference = await loadConference(pool, conferenceId)
  const data = {
    ...SAMPLE_RECIPIENT,
    conference_name: conference.name,
    conference_url: conferenceUrl(conference.slug),
  }
  const sanitizedBody = sanitizeTemplateHtml(input.body_html)
  return {
    subject: renderTemplate(input.subject, data),
    html: wrapEmailHtml(renderHtmlTemplate(sanitizedBody, data)),
  }
}

export type BulkEmailSummary = {
  id: string
  subject: string
  status: 'draft' | 'sent'
  recipient_groups: RecipientGroup[]
  recipient_count: number
  sent_count: number
  failed_count: number
  created_by_name: string
  sent_at: string | null
  created_at: string
}

export async function listBulkEmails(conferenceId: string): Promise<BulkEmailSummary[]> {
  const [rows] = await pool.query(
    `SELECT be.id, be.subject, be.status, be.recipient_groups, be.recipient_count, be.sent_at, be.created_at,
            u.full_name AS created_by_name,
            SUM(CASE WHEN el.status IN ('sent','delivered') THEN 1 ELSE 0 END) AS sent_count,
            SUM(CASE WHEN el.status IN ('failed','bounced') THEN 1 ELSE 0 END) AS failed_count
     FROM bulk_emails be
     JOIN users u ON u.id = be.created_by
     LEFT JOIN bulk_email_recipients ber ON ber.bulk_email_id = be.id
     LEFT JOIN email_logs el ON el.id = ber.email_log_id
     WHERE be.conference_id = ?
     GROUP BY be.id
     ORDER BY be.created_at DESC`,
    [conferenceId],
  )
  return (rows as Array<Omit<BulkEmailSummary, 'recipient_groups'> & { recipient_groups: unknown }>).map((r) => ({
    ...r,
    recipient_groups: parseGroups(r.recipient_groups),
  }))
}

export type BulkEmailDetail = BulkEmailSummary & {
  body_html: string
  recipients: Array<{ recipient_email: string; recipient_name: string | null; delivery_status: string | null; error_message: string | null }>
}

export async function getBulkEmailDetail(conferenceId: string, id: string): Promise<BulkEmailDetail> {
  const [rows] = await pool.query(
    `SELECT be.id, be.subject, be.body_html, be.status, be.recipient_groups, be.recipient_count, be.sent_at, be.created_at,
            u.full_name AS created_by_name
     FROM bulk_emails be
     JOIN users u ON u.id = be.created_by
     WHERE be.id = ? AND be.conference_id = ? LIMIT 1`,
    [id, conferenceId],
  )
  const row = (rows as Array<{
    id: string
    subject: string
    body_html: string
    status: 'draft' | 'sent'
    recipient_groups: unknown
    recipient_count: number
    sent_at: string | null
    created_at: string
    created_by_name: string
  }>)[0]
  if (!row) throw new NotFoundError('This bulk email does not exist.')

  const [recipientRows] = await pool.query(
    `SELECT ber.recipient_email, ber.recipient_name, el.status AS delivery_status, el.error_message
     FROM bulk_email_recipients ber
     LEFT JOIN email_logs el ON el.id = ber.email_log_id
     WHERE ber.bulk_email_id = ?
     ORDER BY ber.recipient_email`,
    [id],
  )
  const recipients = recipientRows as BulkEmailDetail['recipients']

  return {
    id: row.id,
    subject: row.subject,
    body_html: row.body_html,
    status: row.status,
    recipient_groups: parseGroups(row.recipient_groups),
    recipient_count: row.recipient_count,
    sent_at: row.sent_at,
    created_at: row.created_at,
    created_by_name: row.created_by_name,
    sent_count: recipients.filter((r) => r.delivery_status === 'sent' || r.delivery_status === 'delivered').length,
    failed_count: recipients.filter((r) => r.delivery_status === 'failed' || r.delivery_status === 'bounced').length,
    recipients,
  }
}

type DraftRow = { id: string; subject: string; body_html: string; recipient_groups: RecipientGroup[]; status: 'draft' | 'sent' }

async function loadDraftForUpdate(conn: PoolConnection, conferenceId: string, id: string): Promise<DraftRow> {
  const [rows] = await conn.query(
    `SELECT id, subject, body_html, recipient_groups, status FROM bulk_emails WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [id, conferenceId],
  )
  const row = (rows as Array<{ id: string; subject: string; body_html: string; recipient_groups: unknown; status: 'draft' | 'sent' }>)[0]
  if (!row) throw new NotFoundError('This bulk email does not exist.')
  return { id: row.id, subject: row.subject, body_html: row.body_html, status: row.status, recipient_groups: parseGroups(row.recipient_groups) }
}

export async function createDraft(actorUserId: string, conferenceId: string, input: SaveDraftInput): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await loadConference(conn, conferenceId)
    const sanitizedBody = sanitizeTemplateHtml(input.body_html)
    await conn.query(
      `INSERT INTO bulk_emails (conference_id, created_by, subject, body_html, recipient_groups, status)
       VALUES (?, ?, ?, ?, ?, 'draft')`,
      [conferenceId, actorUserId, input.subject, sanitizedBody, JSON.stringify(input.recipient_groups)],
    )
    const [rows] = await conn.query('SELECT id FROM bulk_emails WHERE conference_id = ? ORDER BY created_at DESC LIMIT 1', [
      conferenceId,
    ])
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not save this draft.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'bulk_email.draft_save',
      entityType: 'bulk_emails',
      entityId: id,
      newValues: { subject: input.subject, recipient_groups: input.recipient_groups },
    })
    return { id }
  })
}

export async function updateDraft(actorUserId: string, conferenceId: string, id: string, input: SaveDraftInput): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadDraftForUpdate(conn, conferenceId, id)
    if (current.status !== 'draft') throw new BadRequestError('This bulk email has already been sent and can no longer be edited.')

    const sanitizedBody = sanitizeTemplateHtml(input.body_html)
    await conn.query('UPDATE bulk_emails SET subject = ?, body_html = ?, recipient_groups = ? WHERE id = ?', [
      input.subject,
      sanitizedBody,
      JSON.stringify(input.recipient_groups),
      id,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'bulk_email.draft_save',
      entityType: 'bulk_emails',
      entityId: id,
      oldValues: { subject: current.subject, recipient_groups: current.recipient_groups },
      newValues: { subject: input.subject, recipient_groups: input.recipient_groups },
    })
  })
}

export async function deleteDraft(actorUserId: string, conferenceId: string, id: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadDraftForUpdate(conn, conferenceId, id)
    if (current.status !== 'draft') throw new BadRequestError('Only a draft can be deleted — sent bulk emails stay in history.')
    await conn.query('DELETE FROM bulk_emails WHERE id = ?', [id])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'bulk_email.draft_delete',
      entityType: 'bulk_emails',
      entityId: id,
      oldValues: { subject: current.subject },
    })
  })
}

/** Resolves recipients fresh (never reuses a stale preview), checks the daily quota, queues one personalised email per recipient, and records each in bulk_email_recipients. */
export async function sendBulkEmail(actorUserId: string, conferenceId: string, id: string): Promise<{ recipient_count: number }> {
  return withTransaction(actorUserId, async (conn) => {
    const draft = await loadDraftForUpdate(conn, conferenceId, id)
    if (draft.status !== 'draft') throw new BadRequestError('This bulk email has already been sent.')

    const conference = await loadConference(conn, conferenceId)
    const recipients = await resolveRecipients(conn, conferenceId, draft.recipient_groups)
    if (recipients.length === 0) throw new BadRequestError('No one matches the chosen recipient groups.')

    const quota = await getEmailQuota(conn)
    if (recipients.length > quota.remainingToday) {
      throw new BadRequestError(
        `Sending to ${recipients.length} people would exceed today's remaining email quota (${quota.remainingToday} of ${quota.dailyLimit} left today). Choose fewer recipients or try again tomorrow.`,
      )
    }

    const url = conferenceUrl(conference.slug)
    for (const recipient of recipients) {
      const data = {
        first_name: firstName(recipient.full_name),
        full_name: recipient.full_name,
        conference_name: conference.name,
        conference_url: url,
        bulk_email_id: id,
      }
      const emailLogId = await queueEmail(conn, {
        userId: recipient.user_id,
        conferenceId,
        recipientEmail: recipient.email,
        templateKey: 'bulk_email',
        subject: renderTemplate(draft.subject, data),
        templateData: data,
        entityType: 'bulk_emails',
        entityId: id,
      })
      await conn.query(
        `INSERT INTO bulk_email_recipients (bulk_email_id, email_log_id, user_id, recipient_email, recipient_name)
         VALUES (?, ?, ?, ?, ?)`,
        [id, emailLogId, recipient.user_id, recipient.email, recipient.full_name],
      )
    }

    await conn.query(`UPDATE bulk_emails SET status = 'sent', recipient_count = ?, sent_at = NOW(3) WHERE id = ?`, [
      recipients.length,
      id,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'bulk_email.send',
      entityType: 'bulk_emails',
      entityId: id,
      newValues: { recipient_count: recipients.length, recipient_groups: draft.recipient_groups },
    })
    return { recipient_count: recipients.length }
  })
}

/** Queues one email to the caller with the bulk email's current (possibly unsaved) content — never recorded in bulk_email_recipients, so it never counts toward history or recipient_count. */
export async function sendTestEmail(actorUserId: string, conferenceId: string, id: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const draft = await loadDraftForUpdate(conn, conferenceId, id)
    const conference = await loadConference(conn, conferenceId)
    const [userRows] = await conn.query('SELECT email, full_name FROM users WHERE id = ? LIMIT 1', [actorUserId])
    const me = (userRows as Array<{ email: string; full_name: string }>)[0]
    if (!me) throw new NotFoundError('Your account could not be found.')

    const data = {
      first_name: firstName(me.full_name),
      full_name: me.full_name,
      conference_name: conference.name,
      conference_url: conferenceUrl(conference.slug),
      bulk_email_id: id,
    }
    await queueEmail(conn, {
      userId: actorUserId,
      conferenceId,
      recipientEmail: me.email,
      templateKey: 'bulk_email',
      subject: `[Test] ${renderTemplate(draft.subject, data)}`,
      templateData: data,
      entityType: 'bulk_emails',
      entityId: id,
    })
  })
}
