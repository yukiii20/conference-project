import { pool } from '../../db/pool.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'

export type CertificateProgress = {
  registered: boolean
  checked_in: boolean
  sessions_attended: number
  sessions_by_method: { qr: number; online: number; manual: number }
  /** null = no minimum (checking in is enough). */
  min_sessions: number | null
  /** The 'certificate_release' key date, if the organisers set one. */
  release_at: string | null
  released: boolean
  /** Meets the rules (checked in + enough sessions), whether or not certificates are out yet. */
  eligible: boolean
  /** The released participation certificate, when there is one. */
  certificate: { id: string; certificate_number: string; status: string } | null
  /** One plain sentence: what is missing, or what happens next. */
  message: string
}

function formatDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * Where the person stands for the participation certificate. The rules are the same ones the
 * certificate generator uses (certificates/service.ts eligibleRecipients): a confirmed
 * registration, checked in at the desk, and - if the conference set a minimum - that many
 * sessions attended (scanned at the door or "Join online"; both write session_attendance).
 */
export async function getCertificateProgress(conferenceId: string, userId: string): Promise<CertificateProgress> {
  assertConferenceInSession(conferenceId)
  const [[confRows], [regRows], [minRows], [releaseRows], [attendRows], [certRows]] = await Promise.all([
    pool.query('SELECT timezone FROM conferences WHERE id = ? LIMIT 1', [conferenceId]),
    pool.query(
      `SELECT r.id, EXISTS (SELECT 1 FROM conference_attendance ca WHERE ca.registration_id = r.id) AS checked_in
       FROM registrations r WHERE r.conference_id = ? AND r.user_id = ? AND r.status = 'confirmed' LIMIT 1`,
      [conferenceId, userId],
    ),
    pool.query('SELECT certificate_min_sessions FROM conference_settings WHERE conference_id = ? LIMIT 1', [conferenceId]),
    pool.query(
      `SELECT opens_at, opens_at <= NOW(3) AS released FROM conference_deadlines
       WHERE conference_id = ? AND deadline_type = 'certificate_release' LIMIT 1`,
      [conferenceId],
    ),
    pool.query(`SELECT method, COUNT(*) AS n FROM session_attendance WHERE conference_id = ? AND user_id = ? GROUP BY method`, [conferenceId, userId]),
    pool.query(
      `SELECT c.id, c.certificate_number, c.status FROM certificates c
       JOIN conference_deadlines cd ON cd.conference_id = c.conference_id AND cd.deadline_type = 'certificate_release' AND cd.opens_at <= NOW(3)
       WHERE c.conference_id = ? AND c.recipient_user_id = ? AND c.certificate_type = 'participation'
       ORDER BY c.issued_at DESC LIMIT 1`,
      [conferenceId, userId],
    ),
  ])
  const timeZone = (confRows as Array<{ timezone: string }>)[0]?.timezone ?? 'Asia/Kathmandu'
  const registration = (regRows as Array<{ id: string; checked_in: number }>)[0]
  const minSessions = (minRows as Array<{ certificate_min_sessions: number | null }>)[0]?.certificate_min_sessions ?? null
  const release = (releaseRows as Array<{ opens_at: Date; released: number }>)[0]
  const byMethod = { qr: 0, online: 0, manual: 0 }
  for (const r of attendRows as Array<{ method: keyof typeof byMethod; n: number }>) byMethod[r.method] = Number(r.n)
  const attended = byMethod.qr + byMethod.online + byMethod.manual
  const certificate = (certRows as Array<{ id: string; certificate_number: string; status: string }>)[0] ?? null

  const registered = Boolean(registration)
  const checkedIn = Boolean(registration?.checked_in)
  const enoughSessions = minSessions == null || attended >= minSessions
  const eligible = registered && checkedIn && enoughSessions
  const released = Boolean(release?.released)
  const releaseAt = release ? new Date(release.opens_at).toISOString() : null

  let message: string
  if (!registered) message = 'You need a confirmed registration to get a certificate.'
  else if (!checkedIn) message = 'You have not been checked in yet. Show your QR ticket at the registration desk.'
  else if (!enoughSessions) {
    const need = minSessions! - attended
    message = `You have attended ${attended} of the ${minSessions} sessions needed. Attend ${need} more: scan your ticket at the session door, or use Join online.`
  } else if (certificate?.status === 'revoked') message = 'Your certificate was withdrawn by the organisers. Contact them if you think this is a mistake.'
  else if (certificate) message = 'Your certificate is ready to download.'
  else if (!released) message = releaseAt ? `You qualify. Certificates are available from ${formatDate(releaseAt, timeZone)}.` : 'You qualify. Certificates will be available once the organisers release them.'
  else message = 'You qualify. The organisers have not issued your certificate yet - check back soon.'

  return {
    registered,
    checked_in: checkedIn,
    sessions_attended: attended,
    sessions_by_method: byMethod,
    min_sessions: minSessions,
    release_at: releaseAt,
    released,
    eligible,
    certificate,
    message,
  }
}
