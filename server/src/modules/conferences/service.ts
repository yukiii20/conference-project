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

  // Six independent reads (none depends on another's result) - run them
  // concurrently instead of paying six sequential round trips on every public
  // conference page view.
  const [[tracks], [deadlines], [supporters], [committeeRows], [speakers], [announcements]] = await Promise.all([
    pool.query(
      `SELECT id, name, description FROM conference_tracks
       WHERE conference_id = ? AND is_active = TRUE ORDER BY display_order`,
      [conferenceId],
    ),
    pool.query(
      `SELECT deadline_type, opens_at, closes_at FROM conference_deadlines
       WHERE conference_id = ? AND is_public = TRUE`,
      [conferenceId],
    ),
    pool.query(
      `SELECT id, name, tier, logo_path, website_url FROM conference_supporters
       WHERE conference_id = ? AND is_active = TRUE ORDER BY display_order`,
      [conferenceId],
    ),
    pool.query(
      `SELECT id, name, committee_type, description, display_order FROM committees
       WHERE conference_id = ? AND is_public = TRUE ORDER BY display_order`,
      [conferenceId],
    ),
    pool.query(
      `SELECT id, full_name, designation, affiliation, bio, photo_path, speaker_type, display_order
       FROM conference_speakers
       WHERE conference_id = ? AND is_public = TRUE
       ORDER BY FIELD(speaker_type, 'keynote', 'invited', 'panelist', 'guest'), display_order`,
      [conferenceId],
    ),
    pool.query(
      `SELECT id, title, body, publish_at, created_at FROM announcements
       WHERE conference_id = ? AND status = 'published' AND JSON_CONTAINS(audience, '"all"')
       ORDER BY COALESCE(publish_at, created_at) DESC LIMIT 10`,
      [conferenceId],
    ),
  ])

  // Depends on committeeRows, so it has to run after the batch above.
  const committees = committeeRows as Array<{ id: string; name: string; committee_type: string; description: string | null; display_order: number }>
  let committeeMembers: unknown[] = []
  if (committees.length > 0) {
    const [memberRows] = await pool.query(
      `SELECT cm.committee_id, COALESCE(u.full_name, cm.display_name) AS member_name,
              cm.affiliation, cm.country, cm.member_role, cm.display_order
       FROM committee_members cm
       LEFT JOIN users u ON u.id = cm.user_id
       WHERE cm.committee_id IN (?)
       ORDER BY cm.display_order`,
      [committees.map((c) => c.id)],
    )
    committeeMembers = memberRows as unknown[]
  }
  const committeesWithMembers = committees.map((c) => ({
    ...c,
    members: (committeeMembers as Array<{ committee_id: string } & Record<string, unknown>>)
      .filter((m) => m.committee_id === c.id)
      .map(({ committee_id: _committee_id, ...rest }) => rest),
  }))

  return { conference, tracks, deadlines, supporters, committees: committeesWithMembers, speakers, announcements }
}
