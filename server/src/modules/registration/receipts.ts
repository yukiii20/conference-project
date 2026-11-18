import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { fileTypeFromBuffer } from 'file-type'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { buildPrivatePath, deletePrivateFile, savePrivateFile } from '../../storage/privateFileStore.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js'
import { notifyUser } from '../../utils/notifications.js'
import { plainText } from '../audience/access.js'

/**
 * Tickets with a payment receipt (changes-nov2, Part 6).
 *  - Payment instructions and an optional payment QR image (Attendance), shown on the form for paid categories.
 *  - A pending (paid) registration uploads a receipt (JPG/PNG/PDF, sniffed, 5 MB) with amount, date and
 *    reference -> "Pending confirmation". Private: only the registrant and organisers can open it.
 *  - Organisers confirm (email with ticket + QR, notification) or reject with a reason (email,
 *    notification); after a rejection the participant re-uploads and it is pending again.
 * "Pending confirmation" is the existing status 'pending' with a receipt; "Rejected" is 'pending'
 * with rejected_at set. Free categories are auto-confirmed exactly as before.
 */

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024
export const PAYMENT_QR_MAX_BYTES = 2 * 1024 * 1024
const RECEIPT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }
const QR_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }
const TICKET_QR_LINK_SECONDS = 180 * 24 * 60 * 60 // the QR image in the confirmation email works for 180 days

type UploadedFile = { buffer: Buffer; originalname: string; size: number } | undefined

function cleanName(original: string, ext: string, fallback: string): string {
  const base = original.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 120)
  return `${base || fallback}.${ext}`
}

// ------------------------------------------------------------------ Payment settings (Attendance)

export const paymentSettingsSchema = z.object({
  payment_instructions: z
    .string()
    .nullable()
    .transform((v) => (v == null ? null : plainText(v).trim() || null))
    .pipe(z.string().max(5000, 'Keep the payment instructions to 5,000 characters or fewer.').nullable()),
})

export type PaymentSettings = { payment_instructions: string | null; has_qr: boolean }

async function loadPaymentSettings(conferenceId: string): Promise<PaymentSettings & { payment_qr_path: string | null }> {
  const [rows] = await pool.query('SELECT payment_instructions, payment_qr_path FROM conference_settings WHERE conference_id = ? LIMIT 1', [
    conferenceId,
  ])
  const row = (rows as Array<{ payment_instructions: string | null; payment_qr_path: string | null }>)[0]
  return {
    payment_instructions: row?.payment_instructions ?? null,
    payment_qr_path: row?.payment_qr_path ?? null,
    has_qr: Boolean(row?.payment_qr_path),
  }
}

export async function getPaymentSettings(conferenceId: string): Promise<PaymentSettings> {
  const s = await loadPaymentSettings(conferenceId)
  return { payment_instructions: s.payment_instructions, has_qr: s.has_qr }
}

/** Public: only for a published (non-draft) conference. */
export async function getPublicPaymentInfo(conferenceId: string): Promise<PaymentSettings> {
  const [rows] = await pool.query(`SELECT 1 FROM conferences WHERE id = ? AND deleted_at IS NULL AND status <> 'draft' LIMIT 1`, [conferenceId])
  if ((rows as unknown[]).length === 0) throw new NotFoundError('Conference not found.')
  return getPaymentSettings(conferenceId)
}

export async function getPaymentQrFile(conferenceId: string): Promise<{ path: string; mime: string }> {
  const s = await loadPaymentSettings(conferenceId)
  if (!s.payment_qr_path) throw new NotFoundError('There is no payment QR image.')
  return { path: s.payment_qr_path, mime: s.payment_qr_path.endsWith('.png') ? 'image/png' : 'image/jpeg' }
}

export async function savePaymentInstructions(actorUserId: string, conferenceId: string, instructions: string | null, ctx: AuditContext = {}) {
  await withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `INSERT INTO conference_settings (conference_id, payment_instructions) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE payment_instructions = VALUES(payment_instructions)`,
      [conferenceId, instructions],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'payment_settings.update',
      entityType: 'conference_settings',
      entityId: conferenceId,
      newValues: { payment_instructions_length: instructions?.length ?? 0 },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function uploadPaymentQr(actorUserId: string, conferenceId: string, file: UploadedFile, ctx: AuditContext = {}) {
  if (!file || file.size === 0) throw new BadRequestError('Choose an image to upload.', { file: 'Choose an image to upload.' })
  if (file.size > PAYMENT_QR_MAX_BYTES) throw new BadRequestError('The image must be 2 MB or smaller.', { file: 'The image must be 2 MB or smaller.' })
  const sniffed = await fileTypeFromBuffer(file.buffer)
  const ext = sniffed ? QR_TYPES[sniffed.mime] : undefined
  if (!ext) throw new BadRequestError('Upload a PNG or JPG image.', { file: 'Upload a PNG or JPG image.' })
  const key = buildPrivatePath(`conferences/${conferenceId}/payment`, 'payment-qr', 1, ext)
  await savePrivateFile(key, file.buffer)
  const old = (await loadPaymentSettings(conferenceId)).payment_qr_path
  try {
    await withTransaction(actorUserId, async (conn) => {
      await conn.query(
        `INSERT INTO conference_settings (conference_id, payment_qr_path) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE payment_qr_path = VALUES(payment_qr_path)`,
        [conferenceId, key],
      )
      await insertAuditLog(conn, {
        actorUserId,
        conferenceId,
        action: 'payment_settings.upload_qr',
        entityType: 'conference_settings',
        entityId: conferenceId,
        newValues: { size_bytes: file.size },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
    })
  } catch (err) {
    await deletePrivateFile(key)
    throw err
  }
  if (old) await deletePrivateFile(old)
}

export async function removePaymentQr(actorUserId: string, conferenceId: string, ctx: AuditContext = {}) {
  const old = (await loadPaymentSettings(conferenceId)).payment_qr_path
  if (!old) throw new NotFoundError('There is no payment QR image.')
  await withTransaction(actorUserId, async (conn) => {
    await conn.query('UPDATE conference_settings SET payment_qr_path = NULL WHERE conference_id = ?', [conferenceId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'payment_settings.remove_qr',
      entityType: 'conference_settings',
      entityId: conferenceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
  await deletePrivateFile(old)
}

// ------------------------------------------------------------------ Receipt upload (participant)


export const receiptDetailsSchema = z.object({
  amount: z.coerce
    .number({ message: 'Enter the amount you paid.' })
    .min(0, 'The amount cannot be negative.')
    .max(9_999_999_999, 'The amount is too large.'),
  paid_on: z
    .string({ message: 'Enter the payment date.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the payment date.')
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Enter a real date.')
    // One day of slack for Nepal (UTC+05:45) being ahead of UTC.
    .refine((v) => v <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'The payment date cannot be in the future.'),
  reference: z
    .string({ message: 'Enter the payment reference.' })
    .transform((v) => plainText(v).trim())
    .pipe(z.string().min(1, 'Enter the payment reference or transaction ID.').max(120, 'Keep the reference to 120 characters or fewer.')),
})

export async function uploadMyReceipt(
  userId: string,
  conferenceId: string,
  file: UploadedFile,
  body: unknown,
  ctx: AuditContext = {},
): Promise<void> {
  const parsed = receiptDetailsSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) fields[String(issue.path[0])] ??= issue.message
    throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Check the receipt details.', fields)
  }
  if (!file || file.size === 0) throw new BadRequestError('Choose your receipt file.', { file: 'Choose your receipt file.' })
  if (file.size > RECEIPT_MAX_BYTES) throw new BadRequestError('The receipt must be 5 MB or smaller.', { file: 'The receipt must be 5 MB or smaller.' })
  const sniffed = await fileTypeFromBuffer(file.buffer)
  const ext = sniffed ? RECEIPT_TYPES[sniffed.mime] : undefined
  if (!sniffed || !ext) throw new BadRequestError('Upload a JPG, PNG or PDF file.', { file: 'Upload a JPG, PNG or PDF file.' })

  const [regRows] = await pool.query(
    `SELECT id FROM registrations WHERE conference_id = ? AND user_id = ? AND status <> 'cancelled' ORDER BY registered_at DESC LIMIT 1`,
    [conferenceId, userId],
  )
  const regId = (regRows as Array<{ id: string }>)[0]?.id
  if (!regId) throw new NotFoundError('You are not registered for this conference.')

  const key = buildPrivatePath(`conferences/${conferenceId}/receipts/${regId}`, 'receipt', Date.now(), ext)
  await savePrivateFile(key, file.buffer)
  let oldPath: string | null = null
  try {
    await withTransaction(userId, async (conn) => {
      const [rows] = await conn.query('SELECT status, receipt_path, rejected_at FROM registrations WHERE id = ? FOR UPDATE', [regId])
      const reg = (rows as Array<{ status: string; receipt_path: string | null; rejected_at: string | null }>)[0]!
      if (reg.status !== 'pending') throw new ConflictError('Only a registration that is waiting for payment needs a receipt.')
      oldPath = reg.receipt_path
      await conn.query(
        `UPDATE registrations SET receipt_path = ?, receipt_original_name = ?, receipt_mime_type = ?, receipt_amount = ?,
                receipt_paid_on = ?, receipt_reference = ?, receipt_uploaded_at = NOW(3),
                rejection_reason = NULL, rejected_at = NULL, rejected_by = NULL
         WHERE id = ?`,
        [key, cleanName(file.originalname, ext, 'receipt'), sniffed.mime, parsed.data.amount, parsed.data.paid_on, parsed.data.reference, regId],
      )
      await insertAuditLog(conn, {
        actorUserId: userId,
        conferenceId,
        action: reg.rejected_at ? 'registration.receipt_reupload' : 'registration.receipt_upload',
        entityType: 'registrations',
        entityId: regId,
        newValues: { amount: parsed.data.amount, paid_on: parsed.data.paid_on, reference: parsed.data.reference, mime_type: sniffed.mime },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
    })
  } catch (err) {
    await deletePrivateFile(key)
    throw err
  }
  if (oldPath) await deletePrivateFile(oldPath)
}

type ReceiptFile = { path: string; filename: string; mime: string }

function toReceiptFile(row: { receipt_path: string | null; receipt_original_name: string | null; receipt_mime_type: string | null } | undefined): ReceiptFile {
  if (!row?.receipt_path) throw new NotFoundError('There is no receipt for this registration.')
  return { path: row.receipt_path, filename: row.receipt_original_name ?? 'receipt', mime: row.receipt_mime_type ?? 'application/octet-stream' }
}

export async function getMyReceiptFile(conferenceId: string, userId: string): Promise<ReceiptFile> {
  const [rows] = await pool.query(
    `SELECT receipt_path, receipt_original_name, receipt_mime_type FROM registrations
     WHERE conference_id = ? AND user_id = ? AND status <> 'cancelled' ORDER BY registered_at DESC LIMIT 1`,
    [conferenceId, userId],
  )
  return toReceiptFile((rows as Parameters<typeof toReceiptFile>[0][])[0])
}

export async function getRegistrationReceiptFile(conferenceId: string, registrationId: string): Promise<ReceiptFile> {
  const [rows] = await pool.query(
    'SELECT receipt_path, receipt_original_name, receipt_mime_type FROM registrations WHERE id = ? AND conference_id = ? LIMIT 1',
    [registrationId, conferenceId],
  )
  return toReceiptFile((rows as Parameters<typeof toReceiptFile>[0][])[0])
}

// ------------------------------------------------------------------ Signed ticket QR image (for the email)

function signQr(registrationId: string, expires: number): string {
  return createHmac('sha256', env.SESSION_SECRET).update(`ticket-qr:${registrationId}:${expires}`).digest('base64url')
}

export function ticketQrImageUrl(conferenceId: string, registrationId: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + TICKET_QR_LINK_SECONDS
  return `${env.APP_URL}/api/conferences/${conferenceId}/registrations/${registrationId}/ticket-qr.png?expires=${expires}&sig=${encodeURIComponent(signQr(registrationId, expires))}`
}

/** The qr_token behind a signed email image link - only while the registration is confirmed. */
export async function qrTokenForSignedLink(conferenceId: string, registrationId: string, expires: unknown, sig: unknown): Promise<string> {
  const exp = Number(expires)
  if (!Number.isInteger(exp) || typeof sig !== 'string' || exp * 1000 < Date.now()) throw new NotFoundError('This link has expired.')
  const expected = Buffer.from(signQr(registrationId, exp))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new NotFoundError('Not found.')
  const [rows] = await pool.query(`SELECT qr_token FROM registrations WHERE id = ? AND conference_id = ? AND status = 'confirmed' LIMIT 1`, [
    registrationId,
    conferenceId,
  ])
  const token = (rows as Array<{ qr_token: string }>)[0]?.qr_token
  if (!token) throw new NotFoundError('This ticket is not confirmed.')
  return token
}

// ------------------------------------------------------------------ Emails

type RegEmailRow = {
  id: string
  user_id: string
  registration_number: string
  category_name: string
  full_name: string
  email: string
  conference_code: string
  conference_name: string
  slug: string
  start_date: string | Date
  end_date: string | Date
}

const day = (v: string | Date) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

async function loadRegForEmail(conn: PoolConnection, registrationId: string): Promise<RegEmailRow | null> {
  const [rows] = await conn.query(
    `SELECT r.id, r.user_id, r.registration_number, rc.name AS category_name, u.full_name, u.email,
            c.code AS conference_code, c.name AS conference_name, c.slug, c.start_date, c.end_date
     FROM registrations r
     JOIN registration_categories rc ON rc.id = r.category_id
     JOIN users u ON u.id = r.user_id
     JOIN conferences c ON c.id = r.conference_id
     WHERE r.id = ? LIMIT 1`,
    [registrationId],
  )
  return (rows as RegEmailRow[])[0] ?? null
}

async function templateSubject(conn: PoolConnection, conferenceId: string, key: string, fallback: string): Promise<string> {
  const [rows] = await conn.query(
    `SELECT subject FROM email_templates WHERE template_key = ? AND (conference_id = ? OR conference_id IS NULL)
     ORDER BY conference_id IS NULL LIMIT 1`,
    [key, conferenceId],
  )
  return (rows as Array<{ subject: string }>)[0]?.subject ?? fallback
}

function baseData(row: RegEmailRow) {
  const start = day(row.start_date)
  const end = day(row.end_date)
  return {
    full_name: row.full_name,
    conference_code: row.conference_code,
    conference_name: row.conference_name,
    conference_dates: start === end ? start : `${start} to ${end}`,
    registration_number: row.registration_number,
    category_name: row.category_name,
  }
}

/** "Registration confirmed" with the ticket link and QR image; queued inside the confirming transaction. */
export async function queueRegistrationConfirmedEmail(conn: PoolConnection, conferenceId: string, registrationId: string): Promise<void> {
  const row = await loadRegForEmail(conn, registrationId)
  if (!row) return
  const data = {
    ...baseData(row),
    ticket_url: `${env.APP_URL}/c/${row.slug}/ticket`,
    qr_image_url: ticketQrImageUrl(conferenceId, registrationId),
  }
  const subject = await templateSubject(conn, conferenceId, 'registration_confirmed', '[{{conference_code}}] Registration confirmed - ticket {{registration_number}}')
  await queueEmail(conn, {
    userId: row.user_id,
    conferenceId,
    recipientEmail: row.email,
    templateKey: 'registration_confirmed',
    subject: renderTemplate(subject, data),
    templateData: data,
    entityType: 'registrations',
    entityId: registrationId,
  })
}

// ------------------------------------------------------------------ Reject (organiser)

export const rejectSchema = z.object({
  reason: z
    .string({ message: 'Give a reason.' })
    .transform((v) => plainText(v).trim())
    .pipe(z.string().min(3, 'Give a short reason the participant can act on.').max(500, 'Keep the reason to 500 characters or fewer.')),
})

export async function rejectRegistrationReceipt(
  actorUserId: string,
  conferenceId: string,
  registrationId: string,
  reason: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      'SELECT id, user_id, status, receipt_path, rejected_at FROM registrations WHERE id = ? AND conference_id = ? FOR UPDATE',
      [registrationId, conferenceId],
    )
    const reg = (rows as Array<{ id: string; user_id: string; status: string; receipt_path: string | null; rejected_at: string | null }>)[0]
    if (!reg) throw new NotFoundError('This registration does not exist.')
    if (reg.status !== 'pending' || !reg.receipt_path || reg.rejected_at) {
      throw new ConflictError('Only a receipt that is waiting for confirmation can be rejected.')
    }
    await conn.query('UPDATE registrations SET rejection_reason = ?, rejected_at = NOW(3), rejected_by = ? WHERE id = ?', [
      reason,
      actorUserId,
      registrationId,
    ])
    const row = (await loadRegForEmail(conn, registrationId))!
    await notifyUser(conn, {
      userId: reg.user_id,
      conferenceId,
      type: 'payment',
      title: 'Your payment receipt needs attention',
      body: `The organisers could not confirm your registration: ${reason}`,
      linkPath: `/c/${row.slug}#registration`,
    })
    const data = { ...baseData(row), reason, registration_url: `${env.APP_URL}/c/${row.slug}#registration` }
    const subject = await templateSubject(conn, conferenceId, 'registration_rejected', '[{{conference_code}}] Your payment receipt needs attention')
    await queueEmail(conn, {
      userId: reg.user_id,
      conferenceId,
      recipientEmail: row.email,
      templateKey: 'registration_rejected',
      subject: renderTemplate(subject, data),
      templateData: data,
      entityType: 'registrations',
      entityId: registrationId,
    })
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration.reject',
      entityType: 'registrations',
      entityId: registrationId,
      newValues: { reason },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}
