import { randomUUID } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { queueEmail } from '../../utils/email.js'
import { notifyUser } from '../../utils/notifications.js'
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js'
import type { PaymentInput, RegistrationFeeInput } from './validation.js'

/**
 * Registration fees (price windows per category) and manually recorded payments.
 *
 * - A category can have several prices over time (early bird -> regular -> late -> on site).
 *   The database trigger fees_overlap_* guarantees two active prices never overlap, so "the
 *   price right now" is at most one row.
 * - A category with no prices at all is free. A category that HAS prices but none covering
 *   today can't be registered for (the convenor left a gap) - that's reported, not guessed.
 * - Payments are recorded by staff (cash, bank transfer, eSewa/Khalti receipts...). Once the
 *   successful payments cover the amount due, a pending registration is confirmed automatically.
 */

// -----------------------------------------------------------------------
// Fees
// -----------------------------------------------------------------------

export type FeeRow = {
  id: string
  category_id: string
  fee_type: 'early_bird' | 'regular' | 'late' | 'on_site'
  amount: string
  currency: string
  valid_from: string
  valid_until: string
  is_active: boolean
}

export type CurrentFee = { id: string; amount: number; currency: string; fee_type: FeeRow['fee_type']; valid_until: string }

type Queryable = Pick<PoolConnection, 'query'>

/** The active price covering `at` (default: now), or null. */
export async function currentFeeFor(db: Queryable, categoryId: string, at: Date = new Date()): Promise<CurrentFee | null> {
  const [rows] = await db.query(
    `SELECT id, amount, currency, fee_type, valid_until FROM registration_fees
     WHERE category_id = ? AND is_active = TRUE AND valid_from <= ? AND valid_until > ?
     ORDER BY valid_from DESC LIMIT 1`,
    [categoryId, at, at],
  )
  const row = (rows as Array<{ id: string; amount: string; currency: string; fee_type: FeeRow['fee_type']; valid_until: string }>)[0]
  return row ? { ...row, amount: Number(row.amount) } : null
}

export async function categoryHasActiveFees(db: Queryable, categoryId: string): Promise<boolean> {
  const [rows] = await db.query('SELECT 1 FROM registration_fees WHERE category_id = ? AND is_active = TRUE LIMIT 1', [categoryId])
  return (rows as unknown[]).length > 0
}

/** Current price (or null) for each category in one query - used to show prices next to categories. */
export async function currentFeesByCategory(conferenceId: string, at: Date = new Date()): Promise<Map<string, CurrentFee & { priced: true }>> {
  const [rows] = await pool.query(
    `SELECT f.id, f.category_id, f.amount, f.currency, f.fee_type, f.valid_until
     FROM registration_fees f JOIN registration_categories c ON c.id = f.category_id
     WHERE c.conference_id = ? AND f.is_active = TRUE AND f.valid_from <= ? AND f.valid_until > ?`,
    [conferenceId, at, at],
  )
  const map = new Map<string, CurrentFee & { priced: true }>()
  for (const r of rows as Array<{ id: string; category_id: string; amount: string; currency: string; fee_type: FeeRow['fee_type']; valid_until: string }>) {
    map.set(r.category_id, { id: r.id, amount: Number(r.amount), currency: r.currency, fee_type: r.fee_type, valid_until: r.valid_until, priced: true })
  }
  return map
}

/** Category ids (of this conference) that have at least one active price, current or not. */
export async function pricedCategoryIds(conferenceId: string): Promise<Set<string>> {
  const [rows] = await pool.query(
    `SELECT DISTINCT f.category_id FROM registration_fees f JOIN registration_categories c ON c.id = f.category_id
     WHERE c.conference_id = ? AND f.is_active = TRUE`,
    [conferenceId],
  )
  return new Set((rows as Array<{ category_id: string }>).map((r) => r.category_id))
}

export async function listFees(conferenceId: string): Promise<FeeRow[]> {
  const [rows] = await pool.query(
    `SELECT f.id, f.category_id, f.fee_type, f.amount, f.currency, f.valid_from, f.valid_until, f.is_active
     FROM registration_fees f JOIN registration_categories c ON c.id = f.category_id
     WHERE c.conference_id = ?
     ORDER BY c.display_order, c.name, f.valid_from`,
    [conferenceId],
  )
  return rows as FeeRow[]
}

/** The fees_overlap_* triggers SIGNAL SQLSTATE 45000 with a readable message. */
function overlapMessage(err: unknown): string | null {
  const e = err as { sqlState?: string; sqlMessage?: string }
  return e?.sqlState === '45000' && e.sqlMessage ? e.sqlMessage : null
}

async function assertCategoryInConference(conn: PoolConnection, conferenceId: string, categoryId: string): Promise<void> {
  const [rows] = await conn.query('SELECT 1 FROM registration_categories WHERE id = ? AND conference_id = ? LIMIT 1', [categoryId, conferenceId])
  if ((rows as unknown[]).length === 0) throw new NotFoundError('This category does not exist.')
}

async function loadFee(conn: PoolConnection, conferenceId: string, feeId: string): Promise<FeeRow> {
  const [rows] = await conn.query(
    `SELECT f.id, f.category_id, f.fee_type, f.amount, f.currency, f.valid_from, f.valid_until, f.is_active
     FROM registration_fees f JOIN registration_categories c ON c.id = f.category_id
     WHERE f.id = ? AND c.conference_id = ? LIMIT 1 FOR UPDATE`,
    [feeId, conferenceId],
  )
  const fee = (rows as FeeRow[])[0]
  if (!fee) throw new NotFoundError('This price does not exist.')
  return fee
}

export async function createFee(
  actorUserId: string,
  conferenceId: string,
  categoryId: string,
  input: RegistrationFeeInput,
  ctx: AuditContext = {},
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await assertCategoryInConference(conn, conferenceId, categoryId)
    const id = randomUUID()
    try {
      await conn.query(
        `INSERT INTO registration_fees (id, category_id, fee_type, amount, currency, valid_from, valid_until, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, categoryId, input.fee_type, input.amount, input.currency, input.valid_from, input.valid_until, input.is_active],
      )
    } catch (err) {
      const message = overlapMessage(err)
      if (message) throw new ConflictError(message)
      throw err
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration_fee.create',
      entityType: 'registration_fees',
      entityId: id,
      newValues: { category_id: categoryId, ...input },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { id }
  })
}

export async function updateFee(
  actorUserId: string,
  conferenceId: string,
  feeId: string,
  input: RegistrationFeeInput,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadFee(conn, conferenceId, feeId)
    try {
      await conn.query(
        `UPDATE registration_fees SET fee_type = ?, amount = ?, currency = ?, valid_from = ?, valid_until = ?, is_active = ? WHERE id = ?`,
        [input.fee_type, input.amount, input.currency, input.valid_from, input.valid_until, input.is_active, feeId],
      )
    } catch (err) {
      const message = overlapMessage(err)
      if (message) throw new ConflictError(message)
      throw err
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration_fee.update',
      entityType: 'registration_fees',
      entityId: feeId,
      oldValues: current,
      newValues: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

/** Deletes an unused price; a price someone already registered under is deactivated instead (history stays intact). */
export async function deleteFee(actorUserId: string, conferenceId: string, feeId: string, ctx: AuditContext = {}): Promise<{ deactivated: boolean }> {
  return withTransaction(actorUserId, async (conn) => {
    const current = await loadFee(conn, conferenceId, feeId)
    const [used] = await conn.query('SELECT 1 FROM registrations WHERE fee_id = ? LIMIT 1', [feeId])
    const deactivated = (used as unknown[]).length > 0
    if (deactivated) await conn.query('UPDATE registration_fees SET is_active = FALSE WHERE id = ?', [feeId])
    else await conn.query('DELETE FROM registration_fees WHERE id = ?', [feeId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: deactivated ? 'registration_fee.deactivate' : 'registration_fee.delete',
      entityType: 'registration_fees',
      entityId: feeId,
      oldValues: current,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { deactivated }
  })
}

/**
 * What a new registration in this category costs right now. Throws when the category has
 * prices but none covers today (registration would otherwise silently become free).
 */
export async function priceForNewRegistration(
  conn: PoolConnection,
  categoryId: string,
  defaultCurrency: string,
): Promise<{ feeId: string | null; amount: number; currency: string }> {
  const fee = await currentFeeFor(conn, categoryId)
  if (fee) return { feeId: fee.id, amount: fee.amount, currency: fee.currency }
  if (await categoryHasActiveFees(conn, categoryId)) {
    throw new ConflictError('There is no price for this category today. Please contact the organisers.')
  }
  return { feeId: null, amount: 0, currency: defaultCurrency }
}

// -----------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------

export type PaymentRow = {
  id: string
  amount: string
  currency: string
  method: string
  provider_reference: string | null
  status: string
  failure_reason: string | null
  refunded_amount: string
  recorded_by_name: string | null
  paid_at: string | null
  created_at: string
}

/** Sum of successful payments minus refunds - the SQL snippet is reused in list queries. */
export const AMOUNT_PAID_SQL = `(SELECT COALESCE(SUM(p.amount - p.refunded_amount), 0) FROM payments p WHERE p.registration_id = r.id AND p.status = 'successful')`

async function loadRegistrationForPayment(conn: PoolConnection, conferenceId: string, registrationId: string) {
  const [rows] = await conn.query(
    `SELECT r.id, r.status, r.user_id, r.registration_number, r.amount_due, r.currency, u.full_name, u.email
     FROM registrations r JOIN users u ON u.id = r.user_id
     WHERE r.id = ? AND r.conference_id = ? LIMIT 1 FOR UPDATE`,
    [registrationId, conferenceId],
  )
  const row = (
    rows as Array<{ id: string; status: string; user_id: string; registration_number: string; amount_due: string; currency: string; full_name: string; email: string }>
  )[0]
  if (!row) throw new NotFoundError('This registration does not exist.')
  return row
}

async function amountPaid(conn: Queryable, registrationId: string): Promise<number> {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(amount - refunded_amount), 0) AS paid FROM payments WHERE registration_id = ? AND status = 'successful'`,
    [registrationId],
  )
  return Number((rows as Array<{ paid: string }>)[0]?.paid ?? 0)
}

export async function listPayments(conferenceId: string, registrationId: string): Promise<{ payments: PaymentRow[]; amount_due: string; amount_paid: number; currency: string }> {
  const [regRows] = await pool.query('SELECT amount_due, currency FROM registrations WHERE id = ? AND conference_id = ? LIMIT 1', [registrationId, conferenceId])
  const reg = (regRows as Array<{ amount_due: string; currency: string }>)[0]
  if (!reg) throw new NotFoundError('This registration does not exist.')
  const [rows] = await pool.query(
    `SELECT p.id, p.amount, p.currency, p.method, p.provider_reference, p.status, p.failure_reason, p.refunded_amount,
            u.full_name AS recorded_by_name, p.paid_at, p.created_at
     FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
     WHERE p.registration_id = ? AND p.conference_id = ?
     ORDER BY p.created_at DESC`,
    [registrationId, conferenceId],
  )
  return { payments: rows as PaymentRow[], amount_due: reg.amount_due, amount_paid: await amountPaid(pool, registrationId), currency: reg.currency }
}

function formatAmount(amount: number): string {
  return amount.toFixed(2)
}

export async function recordPayment(
  actorUserId: string,
  conferenceId: string,
  registrationId: string,
  input: PaymentInput,
  ctx: AuditContext = {},
): Promise<{ id: string; amount_paid: number; confirmed: boolean }> {
  return withTransaction(actorUserId, async (conn) => {
    const reg = await loadRegistrationForPayment(conn, conferenceId, registrationId)
    if (reg.status === 'cancelled') throw new ConflictError('This registration was cancelled; a payment cannot be recorded against it.')

    const id = randomUUID()
    await conn.query(
      `INSERT INTO payments (id, conference_id, registration_id, amount, currency, method, provider, provider_reference, status, recorded_by, verified_at, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, 'successful', ?, NOW(3), ?)`,
      [id, conferenceId, registrationId, input.amount, reg.currency, input.method, input.reference ?? null, actorUserId, input.paid_at ?? new Date()],
    )

    const paid = await amountPaid(conn, registrationId)
    const confirmed = reg.status === 'pending' && paid >= Number(reg.amount_due)
    if (confirmed) {
      await conn.query(`UPDATE registrations SET status = 'confirmed', confirmed_at = NOW(3) WHERE id = ?`, [registrationId])
    }

    await queueEmail(conn, {
      userId: reg.user_id,
      conferenceId,
      recipientEmail: reg.email,
      templateKey: 'payment_received',
      subject: '[{{conference_code}}] Payment received',
      templateData: { full_name: reg.full_name, amount: formatAmount(input.amount), currency: reg.currency, registration_number: reg.registration_number },
      entityType: 'payments',
      entityId: id,
    })
    await notifyUser(conn, {
      userId: reg.user_id,
      conferenceId,
      type: 'payment',
      title: confirmed ? 'Payment received - your registration is confirmed' : 'Payment received',
      body: `We recorded your payment of ${formatAmount(input.amount)} ${reg.currency}.`,
    })
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'payment.record',
      entityType: 'payments',
      entityId: id,
      newValues: { registration_id: registrationId, amount: input.amount, method: input.method, reference: input.reference ?? null, auto_confirmed: confirmed },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { id, amount_paid: paid, confirmed }
  })
}

/** Marks a mistakenly recorded payment as cancelled. It never un-confirms a registration by itself. */
export async function voidPayment(
  actorUserId: string,
  conferenceId: string,
  registrationId: string,
  paymentId: string,
  reason: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    await loadRegistrationForPayment(conn, conferenceId, registrationId)
    const [rows] = await conn.query(
      `SELECT id, status, amount FROM payments WHERE id = ? AND registration_id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
      [paymentId, registrationId, conferenceId],
    )
    const payment = (rows as Array<{ id: string; status: string; amount: string }>)[0]
    if (!payment) throw new NotFoundError('This payment does not exist.')
    if (payment.status !== 'successful') throw new ConflictError('Only a successful payment can be voided.')
    await conn.query(`UPDATE payments SET status = 'cancelled', failure_reason = ? WHERE id = ?`, [reason, paymentId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'payment.void',
      entityType: 'payments',
      entityId: paymentId,
      oldValues: { status: payment.status, amount: payment.amount },
      newValues: { status: 'cancelled', reason },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

/** Waives the fee (sponsored speaker, volunteer...): amount due becomes 0 and a pending registration is confirmed. */
export async function waiveRegistrationFee(
  actorUserId: string,
  conferenceId: string,
  registrationId: string,
  reason: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const reg = await loadRegistrationForPayment(conn, conferenceId, registrationId)
    if (reg.status === 'cancelled') throw new ConflictError('This registration was cancelled.')
    if (Number(reg.amount_due) === 0 && reg.status === 'confirmed') throw new BadRequestError('Nothing is owed on this registration.')
    await conn.query(
      `UPDATE registrations
       SET amount_due = 0, waiver_reason = ?, waived_by = ?,
           status = IF(status = 'pending', 'confirmed', status),
           confirmed_at = IF(status = 'confirmed' AND confirmed_at IS NULL, NOW(3), confirmed_at)
       WHERE id = ?`,
      [reason, actorUserId, registrationId],
    )
    await notifyUser(conn, {
      userId: reg.user_id,
      conferenceId,
      type: 'payment',
      title: 'Your registration fee was waived',
      body: reg.status === 'pending' ? 'Your registration is now confirmed.' : 'Nothing further is owed.',
    })
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration.waive',
      entityType: 'registrations',
      entityId: registrationId,
      oldValues: { amount_due: reg.amount_due, status: reg.status },
      newValues: { amount_due: 0, waiver_reason: reason },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}
