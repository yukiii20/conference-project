import QRCode from 'qrcode'
import { pool } from '../../db/pool.js'
import { env } from '../../config/env.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'

export type MyTicket = {
  registration: {
    id: string
    registration_number: string
    status: 'pending' | 'confirmed' | 'waitlisted'
    category_name: string
    registered_at: string
    checked_in: boolean
  }
  holder: { full_name: string; email: string }
  conference: {
    id: string
    name: string
    short_name: string | null
    slug: string
    start_date: string
    end_date: string
    timezone: string
    venue_name: string | null
    address: string | null
    city: string | null
  }
  /** The QR as a PNG data URL, so the ticket page can keep showing it offline (saved on the phone). */
  qr_data_url: string
}

/**
 * Everything the phone ticket page shows, in ONE request. Only the signed-in owner's own live
 * registration; the QR token itself is never in the JSON (only inside the image).
 * `conferenceRef` is the conference id or its slug (the page URL is /c/:slug/ticket); a session
 * bound to another conference gets 403 wrong_conference, exactly like an id in the path.
 */
export async function getMyTicket(conferenceRef: string, userId: string): Promise<MyTicket | null> {
  const [rows] = await pool.query(
    `SELECT r.id, r.registration_number, r.status, r.registered_at, r.qr_token, rc.name AS category_name,
            EXISTS (SELECT 1 FROM conference_attendance ca WHERE ca.registration_id = r.id) AS checked_in,
            u.full_name, u.email,
            c.id AS conference_id, c.name, c.short_name, c.slug, c.start_date, c.end_date, c.timezone, c.venue_name, c.address, c.city
     FROM registrations r
     JOIN registration_categories rc ON rc.id = r.category_id
     JOIN users u ON u.id = r.user_id
     JOIN conferences c ON c.id = r.conference_id AND c.deleted_at IS NULL
     WHERE (c.id = ? OR c.slug = ?) AND r.user_id = ? AND r.status <> 'cancelled'
     ORDER BY r.registered_at DESC LIMIT 1`,
    [conferenceRef, conferenceRef.toLowerCase(), userId],
  )
  const row = (rows as Array<Record<string, unknown>>)[0]
  if (!row) {
    // Still refuse another conference's slug outright, so "no ticket" never hides a wrong sign-in.
    const [conf] = await pool.query(`SELECT id FROM conferences WHERE (id = ? OR slug = ?) AND deleted_at IS NULL LIMIT 1`, [
      conferenceRef,
      conferenceRef.toLowerCase(),
    ])
    const id = (conf as Array<{ id: string }>)[0]?.id
    if (id) assertConferenceInSession(id)
    return null
  }
  assertConferenceInSession(row.conference_id as string)
  const qr_data_url = await QRCode.toDataURL(`${env.APP_URL}/checkin/${row.qr_token as string}`, { width: 360, margin: 2 })
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
  return {
    registration: {
      id: row.id as string,
      registration_number: row.registration_number as string,
      status: row.status as MyTicket['registration']['status'],
      category_name: row.category_name as string,
      registered_at: new Date(row.registered_at as string).toISOString(),
      checked_in: Boolean(row.checked_in),
    },
    holder: { full_name: row.full_name as string, email: row.email as string },
    conference: {
      id: row.conference_id as string,
      name: row.name as string,
      short_name: (row.short_name as string | null) ?? null,
      slug: row.slug as string,
      start_date: day(row.start_date),
      end_date: day(row.end_date),
      timezone: row.timezone as string,
      venue_name: (row.venue_name as string | null) ?? null,
      address: (row.address as string | null) ?? null,
      city: (row.city as string | null) ?? null,
    },
    qr_data_url,
  }
}
