import { pool } from '../../db/pool.js'

const PUBLIC_CONFERENCE_COLUMNS = `
  id, slug, code, name, short_name, tagline, theme, description, start_date, end_date,
  city, country, logo_path, banner_path, primary_color, venue_name, address,
  location_map_url, contact_email, contact_phone, website_url, status
`

export async function listPublicConferences() {
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_CONFERENCE_COLUMNS} FROM conferences
     WHERE status <> 'draft' AND deleted_at IS NULL
     ORDER BY start_date ASC`,
  )
  return rows
}

export async function getPublicConferenceBySlug(slug: string) {
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_CONFERENCE_COLUMNS} FROM conferences
     WHERE slug = ? AND status <> 'draft' AND deleted_at IS NULL LIMIT 1`,
    [slug],
  )
  const conference = (rows as unknown[])[0]
  if (!conference) return null

  const conferenceId = (conference as { id: string }).id

  const [tracks] = await pool.query(
    `SELECT id, name, description FROM conference_tracks
     WHERE conference_id = ? AND is_active = TRUE ORDER BY display_order`,
    [conferenceId],
  )
  const [deadlines] = await pool.query(
    `SELECT deadline_type, opens_at, closes_at FROM conference_deadlines
     WHERE conference_id = ? AND is_public = TRUE`,
    [conferenceId],
  )
  const [supporters] = await pool.query(
    `SELECT id, name, tier, logo_path, website_url FROM conference_supporters
     WHERE conference_id = ? AND is_active = TRUE ORDER BY display_order`,
    [conferenceId],
  )

  return { conference, tracks, deadlines, supporters }
}
