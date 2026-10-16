import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { generateUrlSafeToken } from '../../utils/crypto.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { notifyUser } from '../../utils/notifications.js'
import { buildPublicPath, deletePublicFile, savePublicFile } from '../../storage/fileStore.js'
import { privateFileAbsolutePath, savePrivateFile } from '../../storage/privateFileStore.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PUBLIC_DIR } from '../../storage/paths.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { generateCertificatePdf } from './export.js'
import type { CertificateTemplateInput } from './validation.js'
import { AUTO_CERTIFICATE_TYPES } from './validation.js'

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ER_DUP_ENTRY')
}

// -----------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------

export type TemplateRow = {
  id: string
  certificate_type: string
  name: string
  background_path: string | null
  layout: { name: { y: number; font_size: number; color: string } }
  signatories: Array<{ name: string; title: string; signature_path: string | null }>
  is_active: boolean
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return fallback
}

function mapTemplateRow(row: Omit<TemplateRow, 'layout' | 'signatories'> & { layout: unknown; signatories: unknown }): TemplateRow {
  return {
    ...row,
    layout: parseJson(row.layout, { name: { y: 260, font_size: 48, color: '#1A1A1A' } }),
    signatories: parseJson(row.signatories, []),
  }
}

export async function listTemplates(conferenceId: string): Promise<TemplateRow[]> {
  const [rows] = await pool.query(
    `SELECT id, certificate_type, name, background_path, layout, signatories, is_active
     FROM certificate_templates WHERE conference_id = ? ORDER BY certificate_type, created_at DESC`,
    [conferenceId],
  )
  return (rows as Array<Omit<TemplateRow, 'layout' | 'signatories'> & { layout: unknown; signatories: unknown }>).map(mapTemplateRow)
}

export async function getTemplate(conferenceId: string, templateId: string): Promise<TemplateRow> {
  const [rows] = await pool.query(
    `SELECT id, certificate_type, name, background_path, layout, signatories, is_active
     FROM certificate_templates WHERE id = ? AND conference_id = ? LIMIT 1`,
    [templateId, conferenceId],
  )
  const row = (rows as Array<Omit<TemplateRow, 'layout' | 'signatories'> & { layout: unknown; signatories: unknown }>)[0]
  if (!row) throw new NotFoundError('This certificate template does not exist.')
  return mapTemplateRow(row)
}

async function getActiveTemplate(conn: PoolConnection, conferenceId: string, certificateType: string): Promise<TemplateRow | null> {
  const [rows] = await conn.query(
    `SELECT id, certificate_type, name, background_path, layout, signatories, is_active
     FROM certificate_templates WHERE conference_id = ? AND certificate_type = ? AND is_active = TRUE LIMIT 1`,
    [conferenceId, certificateType],
  )
  const row = (rows as Array<Omit<TemplateRow, 'layout' | 'signatories'> & { layout: unknown; signatories: unknown }>)[0]
  return row ? mapTemplateRow(row) : null
}

export async function createTemplate(
  actorUserId: string,
  conferenceId: string,
  input: CertificateTemplateInput,
  ctx: AuditContext = {},
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    if (input.is_active) {
      await conn.query(
        `UPDATE certificate_templates SET is_active = FALSE WHERE conference_id = ? AND certificate_type = ? AND is_active = TRUE`,
        [conferenceId, input.certificate_type],
      )
    }
    await conn.query(
      `INSERT INTO certificate_templates (conference_id, certificate_type, name, layout, signatories, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [conferenceId, input.certificate_type, input.name, JSON.stringify(input.layout), JSON.stringify(input.signatories), input.is_active],
    )
    const [rows] = await conn.query(
      `SELECT id FROM certificate_templates WHERE conference_id = ? ORDER BY created_at DESC LIMIT 1`,
      [conferenceId],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create this template.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificate_template.create',
      entityType: 'certificate_templates',
      entityId: id,
      newValues: { certificate_type: input.certificate_type, name: input.name },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { id }
  })
}

export async function updateTemplate(
  actorUserId: string,
  conferenceId: string,
  templateId: string,
  input: CertificateTemplateInput,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, certificate_type FROM certificate_templates WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
      [templateId, conferenceId],
    )
    const current = (rows as Array<{ id: string; certificate_type: string }>)[0]
    if (!current) throw new NotFoundError('This certificate template does not exist.')

    if (input.is_active) {
      await conn.query(
        `UPDATE certificate_templates SET is_active = FALSE
         WHERE conference_id = ? AND certificate_type = ? AND is_active = TRUE AND id <> ?`,
        [conferenceId, input.certificate_type, templateId],
      )
    }
    await conn.query(
      `UPDATE certificate_templates SET name = ?, layout = ?, signatories = ?, is_active = ? WHERE id = ?`,
      [input.name, JSON.stringify(input.layout), JSON.stringify(input.signatories), input.is_active, templateId],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificate_template.update',
      entityType: 'certificate_templates',
      entityId: templateId,
      newValues: { name: input.name, is_active: input.is_active },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024

export async function setTemplateBackground(
  actorUserId: string,
  conferenceId: string,
  templateId: string,
  processed: { buffer: Buffer; ext: string },
  ctx: AuditContext = {},
): Promise<{ path: string }> {
  return withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      'SELECT background_path FROM certificate_templates WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE',
      [templateId, conferenceId],
    )
    const current = (rows as Array<{ background_path: string | null }>)[0]
    if (!current) throw new NotFoundError('This certificate template does not exist.')

    const relativePath = buildPublicPath(`certificates/${conferenceId}`, processed.ext)
    await savePublicFile(relativePath, processed.buffer)
    await conn.query('UPDATE certificate_templates SET background_path = ? WHERE id = ?', [relativePath, templateId])
    await deletePublicFile(current.background_path)

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificate_template.set_background',
      entityType: 'certificate_templates',
      entityId: templateId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { path: relativePath }
  })
}

export async function setSignatorySignature(
  actorUserId: string,
  conferenceId: string,
  templateId: string,
  index: number,
  processed: { buffer: Buffer; ext: string },
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const template = await getTemplate(conferenceId, templateId)
    if (index < 0 || index > 1) throw new BadRequestError('There can only be two signatories.')
    const signatories = [...template.signatories]
    while (signatories.length <= index) signatories.push({ name: '', title: '', signature_path: null })

    const relativePath = buildPublicPath(`certificates/${conferenceId}/signatures`, processed.ext)
    await savePublicFile(relativePath, processed.buffer)
    const previousPath = signatories[index]!.signature_path
    signatories[index] = { ...signatories[index]!, signature_path: relativePath }

    await conn.query('UPDATE certificate_templates SET signatories = ? WHERE id = ? AND conference_id = ?', [
      JSON.stringify(signatories),
      templateId,
      conferenceId,
    ])
    await deletePublicFile(previousPath)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificate_template.set_signature',
      entityType: 'certificate_templates',
      entityId: templateId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function removeTemplateBackground(
  actorUserId: string,
  conferenceId: string,
  templateId: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      'SELECT background_path FROM certificate_templates WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE',
      [templateId, conferenceId],
    )
    const current = (rows as Array<{ background_path: string | null }>)[0]
    if (!current) throw new NotFoundError('This certificate template does not exist.')

    await conn.query('UPDATE certificate_templates SET background_path = NULL WHERE id = ?', [templateId])
    await deletePublicFile(current.background_path)

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificate_template.remove_background',
      entityType: 'certificate_templates',
      entityId: templateId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function removeSignatorySignature(
  actorUserId: string,
  conferenceId: string,
  templateId: string,
  index: number,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const template = await getTemplate(conferenceId, templateId)
    if (index < 0 || index > 1) throw new BadRequestError('There can only be two signatories.')
    const signatories = [...template.signatories]
    if (index >= signatories.length) return

    const previousPath = signatories[index]!.signature_path
    signatories[index] = { ...signatories[index]!, signature_path: null }

    await conn.query('UPDATE certificate_templates SET signatories = ? WHERE id = ? AND conference_id = ?', [
      JSON.stringify(signatories),
      templateId,
      conferenceId,
    ])
    await deletePublicFile(previousPath)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificate_template.remove_signature',
      entityType: 'certificate_templates',
      entityId: templateId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

// -----------------------------------------------------------------------
// Eligibility
// -----------------------------------------------------------------------

export type EligibleRecipient = { user_id: string; full_name: string; submission_id?: string; session_id?: string }

async function eligibleRecipients(conferenceId: string, certificateType: (typeof AUTO_CERTIFICATE_TYPES)[number]): Promise<EligibleRecipient[]> {
  switch (certificateType) {
    case 'participation': {
      const [rows] = await pool.query(
        `SELECT DISTINCT r.user_id, u.full_name
         FROM registrations r
         JOIN users u ON u.id = r.user_id
         JOIN conference_settings cs ON cs.conference_id = r.conference_id
         WHERE r.conference_id = ? AND r.status = 'confirmed'
           AND EXISTS (SELECT 1 FROM conference_attendance ca WHERE ca.registration_id = r.id)
           AND (cs.certificate_min_sessions IS NULL
             OR (SELECT COUNT(*) FROM session_attendance sa WHERE sa.user_id = r.user_id AND sa.conference_id = r.conference_id)
                >= cs.certificate_min_sessions)`,
        [conferenceId],
      )
      return rows as EligibleRecipient[]
    }
    case 'presentation': {
      const [rows] = await pool.query(
        `SELECT DISTINCT p.presenter_user_id AS user_id, u.full_name, p.submission_id
         FROM presentations p JOIN users u ON u.id = p.presenter_user_id
         WHERE p.conference_id = ? AND p.status = 'presented' AND p.presenter_user_id IS NOT NULL`,
        [conferenceId],
      )
      return rows as EligibleRecipient[]
    }
    case 'reviewer': {
      const [rows] = await pool.query(
        `SELECT DISTINCT ra.reviewer_id AS user_id, u.full_name
         FROM review_assignments ra
         JOIN reviews rv ON rv.assignment_id = ra.id
         JOIN users u ON u.id = ra.reviewer_id
         WHERE ra.conference_id = ? AND rv.status = 'submitted'`,
        [conferenceId],
      )
      return rows as EligibleRecipient[]
    }
    case 'session_chair': {
      const [rows] = await pool.query(
        `SELECT DISTINCT sc.user_id, u.full_name, sc.session_id
         FROM session_chairs sc
         JOIN conference_sessions s ON s.id = sc.session_id
         JOIN users u ON u.id = sc.user_id
         WHERE s.conference_id = ? AND s.status = 'published' AND s.ends_at < NOW(3)`,
        [conferenceId],
      )
      return rows as EligibleRecipient[]
    }
    case 'staff': {
      const [rows] = await pool.query(
        `SELECT DISTINCT cm.user_id, u.full_name
         FROM conference_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.conference_id = ? AND cm.role_code = 'staff' AND cm.status = 'active'`,
        [conferenceId],
      )
      return rows as EligibleRecipient[]
    }
  }
}

export async function previewEligibleCount(
  conferenceId: string,
  certificateType: (typeof AUTO_CERTIFICATE_TYPES)[number],
): Promise<{ eligible: number; already_issued: number; new: number }> {
  const recipients = await eligibleRecipients(conferenceId, certificateType)
  const [issuedRows] = await pool.query(
    `SELECT dedupe_key FROM certificates WHERE conference_id = ? AND certificate_type = ? AND status = 'issued'`,
    [conferenceId, certificateType],
  )
  const issuedKeys = new Set((issuedRows as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key))
  const pending = recipients.filter((r) => !issuedKeys.has(`${r.submission_id ?? '-'}|${r.session_id ?? '-'}`))
  return { eligible: recipients.length, already_issued: issuedKeys.size, new: pending.length }
}

// -----------------------------------------------------------------------
// Issuing
// -----------------------------------------------------------------------

async function loadConferenceForCertificate(conn: PoolConnection, conferenceId: string) {
  const [rows] = await conn.query(
    `SELECT id, name, code, primary_color, logo_path FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as Array<{ id: string; name: string; code: string; primary_color: string | null; logo_path: string | null }>)[0]
  if (!row) throw new NotFoundError('This conference does not exist.')
  return row
}

async function readPublicFileIfAny(relativePath: string | null): Promise<Buffer | null> {
  if (!relativePath) return null
  try {
    return await readFile(path.join(PUBLIC_DIR, relativePath))
  } catch {
    return null
  }
}

async function nextCertificateNumber(conn: PoolConnection, conferenceId: string, code: string): Promise<string> {
  await conn.query(
    `INSERT INTO conference_counters (conference_id, counter_key, current_value) VALUES (?, 'certificate', 0)
     ON DUPLICATE KEY UPDATE conference_id = conference_id`,
    [conferenceId],
  )
  const [rows] = await conn.query(
    `SELECT current_value FROM conference_counters WHERE conference_id = ? AND counter_key = 'certificate' FOR UPDATE`,
    [conferenceId],
  )
  const next = ((rows as Array<{ current_value: number }>)[0]?.current_value ?? 0) + 1
  await conn.query(`UPDATE conference_counters SET current_value = ? WHERE conference_id = ? AND counter_key = 'certificate'`, [
    next,
    conferenceId,
  ])
  return `${code}-C${String(next).padStart(4, '0')}`
}

async function issueOne(
  conn: PoolConnection,
  conferenceId: string,
  actorUserId: string,
  recipientUserId: string,
  recipientName: string,
  certificateType: string,
  template: TemplateRow | null,
  submissionId: string | null,
  sessionId: string | null,
  ctx: AuditContext,
): Promise<string | null> {
  const conference = await loadConferenceForCertificate(conn, conferenceId)
  const certificateNumber = await nextCertificateNumber(conn, conferenceId, conference.code)
  const verificationToken = generateUrlSafeToken(32)

  let certificateId: string
  try {
    await conn.query(
      `INSERT INTO certificates
         (conference_id, recipient_user_id, recipient_name, certificate_type, template_id, submission_id, session_id,
          certificate_number, verification_token, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conferenceId,
        recipientUserId,
        recipientName,
        certificateType,
        template?.id ?? null,
        submissionId,
        sessionId,
        certificateNumber,
        verificationToken,
        actorUserId,
      ],
    )
  } catch (err) {
    if (isDuplicateKeyError(err)) return null // already issued — re-running only fills in the gaps
    throw err
  }
  const [idRows] = await conn.query('SELECT id FROM certificates WHERE certificate_number = ? LIMIT 1', [certificateNumber])
  certificateId = (idRows as Array<{ id: string }>)[0]!.id

  const [backgroundBuffer, logoBuffer, signatureBuffers] = await Promise.all([
    readPublicFileIfAny(template?.background_path ?? null),
    readPublicFileIfAny(conference.logo_path),
    Promise.all((template?.signatories ?? []).map((s) => readPublicFileIfAny(s.signature_path))),
  ])

  const pdf = await generateCertificatePdf({
    recipientName,
    conferenceName: conference.name,
    certificateType,
    certificateNumber,
    issuedAt: new Date(),
    verificationToken,
    backgroundBuffer,
    logoBuffer,
    primaryColor: conference.primary_color ?? '#2747A0',
    layout: template?.layout ?? { name: { y: 260, font_size: 48, color: '#1A1A1A' } },
    signatories: template?.signatories ?? [],
    signatureBuffers,
  })

  const filePath = `certificates/${conferenceId}/${certificateId}.pdf`
  await savePrivateFile(filePath, pdf)
  await conn.query('UPDATE certificates SET file_path = ? WHERE id = ?', [filePath, certificateId])

  await insertAuditLog(conn, {
    actorUserId,
    conferenceId,
    action: 'certificate.issue',
    entityType: 'certificates',
    entityId: certificateId,
    newValues: { certificate_type: certificateType, recipient_user_id: recipientUserId },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  })
  return certificateId
}

/** A one-off sample PDF for the template editor's "live preview" — nothing is written to the database. */
export async function previewTemplatePdf(conferenceId: string, templateId: string): Promise<Buffer> {
  const template = await getTemplate(conferenceId, templateId)
  const conference = await pool.query(
    `SELECT name, primary_color, logo_path FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [conferenceId],
  ).then(([rows]) => (rows as Array<{ name: string; primary_color: string | null; logo_path: string | null }>)[0])
  if (!conference) throw new NotFoundError('This conference does not exist.')

  const [backgroundBuffer, logoBuffer, signatureBuffers] = await Promise.all([
    readPublicFileIfAny(template.background_path),
    readPublicFileIfAny(conference.logo_path),
    Promise.all(template.signatories.map((s) => readPublicFileIfAny(s.signature_path))),
  ])

  return generateCertificatePdf({
    recipientName: 'Jordan Sample',
    conferenceName: conference.name,
    certificateType: template.certificate_type,
    certificateNumber: 'SAMPLE-0000',
    issuedAt: new Date(),
    verificationToken: '0'.repeat(32),
    backgroundBuffer,
    logoBuffer,
    primaryColor: conference.primary_color ?? '#2747A0',
    layout: template.layout,
    signatories: template.signatories,
    signatureBuffers,
  })
}

export async function generateCertificates(
  actorUserId: string,
  conferenceId: string,
  certificateType: (typeof AUTO_CERTIFICATE_TYPES)[number],
  templateId: string | null | undefined,
  ctx: AuditContext = {},
): Promise<{ issued: number; skipped: number }> {
  return withTransaction(actorUserId, async (conn) => {
    const template = templateId ? await getTemplate(conferenceId, templateId) : await getActiveTemplate(conn, conferenceId, certificateType)
    const recipients = await eligibleRecipients(conferenceId, certificateType)
    let issued = 0
    let skipped = 0
    for (const r of recipients) {
      const id = await issueOne(
        conn,
        conferenceId,
        actorUserId,
        r.user_id,
        r.full_name,
        certificateType,
        template,
        r.submission_id ?? null,
        r.session_id ?? null,
        ctx,
      )
      if (id) issued += 1
      else skipped += 1
    }
    return { issued, skipped }
  })
}

export async function issueBestPaperCertificates(
  actorUserId: string,
  conferenceId: string,
  submissionId: string,
  templateId: string | null | undefined,
  ctx: AuditContext = {},
): Promise<{ issued: number; skipped: number }> {
  return withTransaction(actorUserId, async (conn) => {
    const [subRows] = await conn.query('SELECT id FROM submissions WHERE id = ? AND conference_id = ? LIMIT 1', [
      submissionId,
      conferenceId,
    ])
    if ((subRows as unknown[]).length === 0) throw new NotFoundError('This submission does not exist.')

    const [authorRows] = await conn.query(
      `SELECT user_id, full_name FROM submission_authors WHERE submission_id = ? AND user_id IS NOT NULL`,
      [submissionId],
    )
    const authors = authorRows as Array<{ user_id: string; full_name: string }>
    const template = templateId ? await getTemplate(conferenceId, templateId) : await getActiveTemplate(conn, conferenceId, 'best_paper')

    let issued = 0
    let skipped = 0
    for (const author of authors) {
      const id = await issueOne(conn, conferenceId, actorUserId, author.user_id, author.full_name, 'best_paper', template, submissionId, null, ctx)
      if (id) issued += 1
      else skipped += 1
    }
    return { issued, skipped }
  })
}

export async function issueSpeakerCertificate(
  actorUserId: string,
  conferenceId: string,
  speakerId: string,
  templateId: string | null | undefined,
  ctx: AuditContext = {},
): Promise<{ issued: boolean }> {
  return withTransaction(actorUserId, async (conn) => {
    const [speakerRows] = await conn.query(
      'SELECT user_id, full_name FROM conference_speakers WHERE id = ? AND conference_id = ? LIMIT 1',
      [speakerId, conferenceId],
    )
    const speaker = (speakerRows as Array<{ user_id: string | null; full_name: string }>)[0]
    if (!speaker) throw new NotFoundError('This speaker does not exist.')
    if (!speaker.user_id) throw new BadRequestError('This speaker has no linked account to issue a certificate to.')

    const template = templateId ? await getTemplate(conferenceId, templateId) : await getActiveTemplate(conn, conferenceId, 'speaker')
    const id = await issueOne(conn, conferenceId, actorUserId, speaker.user_id, speaker.full_name, 'speaker', template, null, null, ctx)
    return { issued: Boolean(id) }
  })
}

// -----------------------------------------------------------------------
// Release, download, revoke, verify
// -----------------------------------------------------------------------

export type CertificateRow = {
  id: string
  recipient_name: string
  certificate_type: string
  certificate_number: string
  issued_at: string
  status: string
  revoked_reason: string | null
}

export type MyCertificateRow = CertificateRow & {
  verification_token: string
  conference_id: string
  conference_name: string
  conference_slug: string
}

export async function listCertificates(conferenceId: string): Promise<CertificateRow[]> {
  const [rows] = await pool.query(
    `SELECT id, recipient_name, certificate_type, certificate_number, issued_at, status, revoked_reason
     FROM certificates WHERE conference_id = ? ORDER BY issued_at DESC`,
    [conferenceId],
  )
  return rows as CertificateRow[]
}

// A recipient only ever sees a certificate once it's released (or it's been
// revoked, which can only happen after issuing — revoked ones still show,
// just as "Revoked") — never an issued-but-not-yet-released one, which
// would otherwise dead-end at a 403 if they tried to download it.
const RELEASED_OR_REVOKED_JOIN = `
  LEFT JOIN conference_deadlines cd
    ON cd.conference_id = c.conference_id AND cd.deadline_type = 'certificate_release' AND cd.opens_at <= NOW(3)`
const RELEASED_OR_REVOKED_WHERE = `(c.status = 'revoked' OR cd.id IS NOT NULL)`

export async function listMyCertificates(conferenceId: string, userId: string): Promise<MyCertificateRow[]> {
  const [rows] = await pool.query(
    `SELECT c.id, c.recipient_name, c.certificate_type, c.certificate_number, c.issued_at, c.status, c.revoked_reason,
            c.verification_token, c.conference_id, co.name AS conference_name, co.slug AS conference_slug
     FROM certificates c
     JOIN conferences co ON co.id = c.conference_id
     ${RELEASED_OR_REVOKED_JOIN}
     WHERE c.conference_id = ? AND c.recipient_user_id = ? AND ${RELEASED_OR_REVOKED_WHERE}
     ORDER BY c.issued_at DESC`,
    [conferenceId, userId],
  )
  return rows as MyCertificateRow[]
}

/** Cross-conference — every released (or revoked) certificate this user holds, anywhere. */
export async function listMyCertificatesEverywhere(userId: string): Promise<MyCertificateRow[]> {
  const [rows] = await pool.query(
    `SELECT c.id, c.recipient_name, c.certificate_type, c.certificate_number, c.issued_at, c.status, c.revoked_reason,
            c.verification_token, c.conference_id, co.name AS conference_name, co.slug AS conference_slug
     FROM certificates c
     JOIN conferences co ON co.id = c.conference_id
     ${RELEASED_OR_REVOKED_JOIN}
     WHERE c.recipient_user_id = ? AND ${RELEASED_OR_REVOKED_WHERE}
     ORDER BY c.issued_at DESC`,
    [userId],
  )
  return rows as MyCertificateRow[]
}

/**
 * The release gate — the 'certificate_release' key date, or the convenor's
 * manual override. Release state isn't stored separately: a certificate is
 * released once this returns true for its conference. The opens_at <= now
 * comparison is done in SQL (not by fetching opens_at and comparing against
 * Node's Date.now()) so it can never be thrown off by clock skew between
 * this process and the database server.
 */
export async function isReleased(conferenceId: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1 FROM conference_deadlines WHERE conference_id = ? AND deadline_type = 'certificate_release' AND opens_at <= NOW(3) LIMIT 1`,
    [conferenceId],
  )
  return (rows as unknown[]).length > 0
}

export async function releaseNow(actorUserId: string, conferenceId: string, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at)
       VALUES (?, 'certificate_release', NOW(3))
       ON DUPLICATE KEY UPDATE opens_at = LEAST(opens_at, NOW(3))`,
      [conferenceId],
    )
    const [rows] = await conn.query(
      `SELECT c.recipient_user_id, c.id, u.email, u.full_name
       FROM certificates c JOIN users u ON u.id = c.recipient_user_id
       WHERE c.conference_id = ? AND c.status = 'issued'`,
      [conferenceId],
    )
    const recipients = rows as Array<{ recipient_user_id: string; id: string; email: string; full_name: string }>
    const [confRows] = await conn.query('SELECT name, code FROM conferences WHERE id = ? LIMIT 1', [conferenceId])
    const conference = (confRows as Array<{ name: string; code: string }>)[0]
    const [templateRows] = await conn.query(
      `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'certificate_available' LIMIT 1`,
    )
    const template = (templateRows as Array<{ subject: string }>)[0]
    for (const r of recipients) {
      const data = { full_name: r.full_name, conference_name: conference?.name ?? '', conference_code: conference?.code ?? '' }
      const subject = template ? renderTemplate(template.subject, data) : 'Your certificate is ready'
      await queueEmail(conn, {
        userId: r.recipient_user_id,
        conferenceId,
        recipientEmail: r.email,
        templateKey: 'certificate_available',
        subject,
        templateData: data,
      })
      await notifyUser(conn, {
        userId: r.recipient_user_id,
        conferenceId,
        type: 'certificate',
        title: 'Your certificate is ready',
        body: 'You can now download your certificate.',
      })
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificates.release_now',
      entityType: 'certificates',
      newValues: { count: recipients.length },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function downloadCertificate(
  conferenceId: string,
  certificateId: string,
  requestingUserId: string,
  hasManagePermission: boolean,
): Promise<{ absolutePath: string; filename: string }> {
  const [rows] = await pool.query(
    'SELECT id, recipient_user_id, certificate_number, file_path, status FROM certificates WHERE id = ? AND conference_id = ? LIMIT 1',
    [certificateId, conferenceId],
  )
  const cert = (rows as Array<{ id: string; recipient_user_id: string; certificate_number: string; file_path: string | null; status: string }>)[0]
  if (!cert || !cert.file_path) throw new NotFoundError('This certificate does not exist.')

  const isOwner = cert.recipient_user_id === requestingUserId
  if (!isOwner && !hasManagePermission) {
    throw new ForbiddenError('You do not have permission to download this certificate.')
  }
  if (isOwner && !hasManagePermission && !(await isReleased(conferenceId))) {
    throw new ForbiddenError('Certificates have not been released yet.')
  }

  return { absolutePath: privateFileAbsolutePath(cert.file_path), filename: `${cert.certificate_number}.pdf` }
}

export async function revokeCertificate(actorUserId: string, conferenceId: string, certificateId: string, reason: string, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id, status FROM certificates WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE', [
      certificateId,
      conferenceId,
    ])
    const current = (rows as Array<{ id: string; status: string }>)[0]
    if (!current) throw new NotFoundError('This certificate does not exist.')
    if (current.status === 'revoked') throw new BadRequestError('This certificate is already revoked.')

    await conn.query(`UPDATE certificates SET status = 'revoked', revoked_at = NOW(3), revoked_reason = ? WHERE id = ?`, [
      reason,
      certificateId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'certificate.revoke',
      entityType: 'certificates',
      entityId: certificateId,
      newValues: { reason },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export type VerifyResult = {
  valid: boolean
  status: string
  recipient_name: string
  certificate_type: string
  conference_name: string
  issued_at: string
} | null

export async function verifyCertificate(token: string): Promise<VerifyResult> {
  const [rows] = await pool.query(
    `SELECT c.status, c.recipient_name, c.certificate_type, c.issued_at, co.name AS conference_name
     FROM certificates c JOIN conferences co ON co.id = c.conference_id
     WHERE c.verification_token = ? LIMIT 1`,
    [token],
  )
  const row = (rows as Array<{ status: string; recipient_name: string; certificate_type: string; issued_at: string; conference_name: string }>)[0]
  if (!row) return null
  return { valid: row.status === 'issued', status: row.status, recipient_name: row.recipient_name, certificate_type: row.certificate_type, conference_name: row.conference_name, issued_at: row.issued_at }
}

export { BACKGROUND_MAX_BYTES }
