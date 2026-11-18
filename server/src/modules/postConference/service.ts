import { env } from '../../config/env.js'
import { pool } from '../../db/pool.js'
import { insertAuditLog } from '../../utils/audit.js'
import { isConferenceEnded } from '../../utils/conferenceEnded.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'
import { createDraft, deleteDraft, listBulkEmails, sendBulkEmail, type BulkEmailSummary } from '../bulkEmail/service.js'
import type { SaveDraftInput } from '../bulkEmail/validation.js'
import { withTransaction } from '../../db/withTransaction.js'

/**
 * Post-conference email (changes-nov2, Part 5). A thin layer over the existing bulk email
 * tool: the email is an ordinary bulk email (same queue, quota, recipient tracking and
 * history), tagged bulk_emails.kind = 'post_conference', and only allowed after the end date.
 */

export const POST_CONFERENCE_GROUPS = ['attendees_registered', 'all_authors', 'reviewers', 'speakers', 'staff'] as const

type ConferenceRow = { id: string; name: string; slug: string; end_date: string }

async function loadConference(conferenceId: string): Promise<ConferenceRow> {
  const [rows] = await pool.query('SELECT id, name, slug, end_date FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [conferenceId])
  const row = (rows as ConferenceRow[])[0]
  if (!row) throw new NotFoundError('This conference does not exist.')
  return row
}

function defaults(conference: ConferenceRow) {
  const page = `${env.APP_URL}/c/${conference.slug}`
  const links = {
    certificates: `${env.APP_URL}/portal/certificates`,
    report: `${page}#archive`,
    publication: `${page}#publication`,
    archive: `${page}#archive`,
  }
  const subject = 'Thank you for joining {{conference_name}}'
  const body_html = [
    '<p>Dear {{first_name}},</p>',
    '<p>Thank you for being part of {{conference_name}}. The conference has now ended.</p>',
    '<ul>',
    `<li>Certificates: <a href="${links.certificates}">${links.certificates}</a></li>`,
    `<li>Conference report: <a href="${links.report}">${links.report}</a></li>`,
    `<li>Publication information: <a href="${links.publication}">${links.publication}</a></li>`,
    `<li>Archive of presentations and papers: <a href="${links.archive}">${links.archive}</a></li>`,
    '</ul>',
    '<p>You can always find the conference page at <a href="{{conference_url}}">{{conference_url}}</a>.</p>',
    '<p>With thanks,<br>The organising team</p>',
  ].join('\n')
  return { subject, body_html, links }
}

async function postConferenceIds(conferenceId: string): Promise<Set<string>> {
  const [rows] = await pool.query(`SELECT id FROM bulk_emails WHERE conference_id = ? AND kind = 'post_conference'`, [conferenceId])
  return new Set((rows as Array<{ id: string }>).map((r) => r.id))
}

export type PostConferenceState = {
  ended: boolean
  end_date: string
  groups: readonly string[]
  defaults: { subject: string; body_html: string; links: Record<string, string> }
  sent: BulkEmailSummary[]
  /** True after the end while no post-conference email has been sent (drives the dashboard card). */
  reminder: boolean
}

export async function getPostConferenceState(conferenceId: string): Promise<PostConferenceState> {
  const conference = await loadConference(conferenceId)
  const ended = isConferenceEnded(conference.end_date)
  const ids = await postConferenceIds(conferenceId)
  const sent = (await listBulkEmails(conferenceId)).filter((b) => ids.has(b.id) && b.status === 'sent')
  return {
    ended,
    end_date: conference.end_date,
    groups: POST_CONFERENCE_GROUPS,
    defaults: defaults(conference),
    sent,
    reminder: ended && sent.length === 0,
  }
}

/** Saves the email as a post-conference bulk email and sends it through the existing queue. */
export async function sendPostConferenceEmail(
  actorUserId: string,
  conferenceId: string,
  input: SaveDraftInput,
): Promise<{ id: string; recipient_count: number; previously_sent: number }> {
  const conference = await loadConference(conferenceId)
  if (!isConferenceEnded(conference.end_date)) {
    throw new ConflictError('The post-conference email can be sent only after the conference has ended.')
  }
  const previouslySent = (await getPostConferenceState(conferenceId)).sent.length
  const { id } = await createDraft(actorUserId, conferenceId, input)
  await withTransaction(actorUserId, async (conn) => {
    await conn.query(`UPDATE bulk_emails SET kind = 'post_conference' WHERE id = ?`, [id])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'post_conference_email.send',
      entityType: 'bulk_emails',
      entityId: id,
      newValues: { recipient_groups: input.recipient_groups, previously_sent: previouslySent },
    })
  })
  try {
    const { recipient_count } = await sendBulkEmail(actorUserId, conferenceId, id)
    return { id, recipient_count, previously_sent: previouslySent }
  } catch (err) {
    // Nothing was queued (sendBulkEmail is one transaction): drop the draft so no half-sent record remains.
    await deleteDraft(actorUserId, conferenceId, id).catch(() => undefined)
    throw err
  }
}
