import { pool } from '../db/pool.js'
import { htmlToText, wrapEmailHtml } from './layout.js'
import { getMailProvider } from './provider.js'
import { renderHtmlTemplate } from './render.js'

const BATCH_SIZE = 20
const POLL_INTERVAL_MS = 10_000
const MAX_ATTEMPTS = 5
const STUCK_SENDING_MINUTES = 10

// Placeholder keys that hold a one-time secret (invite_url, reset_url, accept_url, ...).
const SECRET_KEY_PATTERN = /(_url|_link|token)$/i

export function redactSecrets(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : value
  }
  return result
}

type QueuedEmailRow = {
  id: number
  conference_id: string | null
  recipient_email: string
  template_key: string
  subject: string
  template_data: Record<string, unknown>
  attempts: number
}

/** Marks up to BATCH_SIZE due rows as 'sending' atomically, so two worker ticks (or processes) never grab the same row. */
async function claimBatch(): Promise<number[]> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query(
      `SELECT id FROM email_logs
       WHERE status = 'queued'
          OR (status = 'failed' AND attempts < ? AND updated_at < DATE_SUB(NOW(3), INTERVAL POW(2, attempts) MINUTE))
       ORDER BY queued_at
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS, BATCH_SIZE],
    )
    const ids = (rows as Array<{ id: number }>).map((r) => r.id)
    if (ids.length > 0) {
      await conn.query(`UPDATE email_logs SET status = 'sending' WHERE id IN (?)`, [ids])
    }
    await conn.commit()
    return ids
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** Conference-specific template first, else the platform default (conference_id IS NULL). */
async function loadTemplateBody(templateKey: string, conferenceId: string | null): Promise<string | null> {
  const [rows] = await pool.query(
    `SELECT body_html FROM email_templates
     WHERE template_key = ? AND is_active = TRUE AND (conference_id = ? OR conference_id IS NULL)
     ORDER BY conference_id IS NULL ASC
     LIMIT 1`,
    [templateKey, conferenceId],
  )
  return (rows as Array<{ body_html: string }>)[0]?.body_html ?? null
}

/**
 * A bulk email (server/src/modules/bulkEmail) has no email_templates row —
 * its body is one-off, composed by the convenor and stored on the
 * bulk_emails row itself, referenced by id in template_data (never the
 * rendered HTML itself — same "store placeholder values, not bodies"
 * convention as every other queued email).
 */
async function loadBulkEmailBody(bulkEmailId: unknown): Promise<string | null> {
  if (typeof bulkEmailId !== 'string') return null
  const [rows] = await pool.query('SELECT body_html FROM bulk_emails WHERE id = ? LIMIT 1', [bulkEmailId])
  return (rows as Array<{ body_html: string }>)[0]?.body_html ?? null
}

async function processRow(row: QueuedEmailRow): Promise<void> {
  try {
    const bodyTemplate =
      row.template_key === 'bulk_email'
        ? await loadBulkEmailBody(row.template_data.bulk_email_id)
        : await loadTemplateBody(row.template_key, row.conference_id)
    const content = bodyTemplate ? renderHtmlTemplate(bodyTemplate, row.template_data) : `<p>${row.subject}</p>`
    const html = wrapEmailHtml(content)
    const text = htmlToText(html)

    const result = await getMailProvider().sendMail({ to: row.recipient_email, subject: row.subject, html, text })

    // Sent — the secret link (if any) has done its job; redact it from the record.
    await pool.query(
      `UPDATE email_logs SET status = 'sent', sent_at = NOW(3), provider_message_id = ?, template_data = ? WHERE id = ?`,
      [result.providerMessageId ?? null, JSON.stringify(redactSecrets(row.template_data)), row.id],
    )
  } catch (err) {
    const nextAttempts = row.attempts + 1
    const message = (err instanceof Error ? err.message : 'Unknown error sending this email.').slice(0, 1000)
    const exhausted = nextAttempts >= MAX_ATTEMPTS

    if (exhausted) {
      await pool.query(
        `UPDATE email_logs SET status = 'failed', attempts = ?, error_message = ?, template_data = ? WHERE id = ?`,
        [nextAttempts, message, JSON.stringify(redactSecrets(row.template_data)), row.id],
      )
    } else {
      await pool.query(`UPDATE email_logs SET status = 'failed', attempts = ?, error_message = ? WHERE id = ?`, [
        nextAttempts,
        message,
        row.id,
      ])
    }
  }
}

export async function runEmailWorkerOnce(): Promise<void> {
  const ids = await claimBatch()
  if (ids.length === 0) return

  const [rows] = await pool.query(
    `SELECT id, conference_id, recipient_email, template_key, subject, template_data, attempts
     FROM email_logs WHERE id IN (?)`,
    [ids],
  )
  for (const row of rows as QueuedEmailRow[]) {
    // One row's SMTP failure must never stop the rest of the batch (or the server).
    await processRow(row).catch((err) => console.error(`Email worker: row ${row.id} failed unexpectedly:`, err))
  }
}

/** A crash or restart mid-send can leave rows stuck in 'sending' forever — requeue anything stale on startup. */
export async function recoverStuckSendingRows(): Promise<void> {
  await pool.query(
    `UPDATE email_logs SET status = 'queued' WHERE status = 'sending' AND updated_at < DATE_SUB(NOW(3), INTERVAL ? MINUTE)`,
    [STUCK_SENDING_MINUTES],
  )
}

let timer: ReturnType<typeof setInterval> | null = null

export function startEmailWorker(): void {
  if (timer) return
  recoverStuckSendingRows().catch((err) => console.error('Email worker: could not recover stuck rows:', err))
  timer = setInterval(() => {
    runEmailWorkerOnce().catch((err) => console.error('Email worker: batch failed:', err))
  }, POLL_INTERVAL_MS)
}

export function stopEmailWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
