import { pool } from '../db/pool.js'

/** Used in previews when the conference has no registered participants yet. */
export const FALLBACK_RECIPIENT_NAME = 'Recipient Name'

/**
 * A real participant's name for previews (certificates, emails): the earliest confirmed
 * registrant of the conference, else the earliest non-cancelled one. Falls back to a
 * placeholder when nobody has registered yet.
 */
export async function sampleRecipientName(conferenceId: string): Promise<string> {
  const [rows] = await pool.query(
    `SELECT u.full_name
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     WHERE r.conference_id = ? AND r.status <> 'cancelled'
     ORDER BY (r.status = 'confirmed') DESC, r.registered_at ASC
     LIMIT 1`,
    [conferenceId],
  )
  const name = (rows as Array<{ full_name: string | null }>)[0]?.full_name?.trim()
  return name || FALLBACK_RECIPIENT_NAME
}
