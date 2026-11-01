import { pool } from '../../db/pool.js'

/**
 * Brevo transactional-email webhooks -> email_logs.status.
 *
 * The worker marks a row 'sent' once Brevo accepts it (and stores Brevo's message id). Only the
 * webhook can say what happened next: 'delivered' (the recipient's server took it) or
 * 'bounced' (it never will). Events can arrive late, twice or out of order, so every update is
 * guarded: 'delivered' only upgrades a 'sent' row, and a bounce is final (never overwritten).
 */

export type BrevoEvent = { event?: unknown; 'message-id'?: unknown; email?: unknown; reason?: unknown }
export type EmailOutcome = { messageId: string; status: 'delivered' | 'bounced'; reason: string | null }

const BOUNCE_EVENTS = new Set(['hard_bounce', 'invalid_email', 'blocked', 'error'])

/** Brevo writes ids as "<x@smtp-relay>" in some places and bare in others; compare without the brackets. */
export function normaliseMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, '')
}

/**
 * Turns one webhook payload into the status change it implies, or null for events that don't
 * change delivery status (opened, click, soft_bounce - Brevo retries those itself - etc.).
 */
export function classifyBrevoEvent(payload: BrevoEvent): EmailOutcome | null {
  const event = typeof payload.event === 'string' ? payload.event.toLowerCase() : ''
  const rawId = typeof payload['message-id'] === 'string' ? payload['message-id'] : ''
  const messageId = normaliseMessageId(rawId)
  if (!messageId) return null
  if (event === 'delivered') return { messageId, status: 'delivered', reason: null }
  if (BOUNCE_EVENTS.has(event)) {
    const why = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : event.replace('_', ' ')
    return { messageId, status: 'bounced', reason: `Brevo: ${why}`.slice(0, 1000) }
  }
  return null
}

/** Applies a batch of webhook payloads. Returns how many email_logs rows changed. */
export async function applyBrevoEvents(payloads: BrevoEvent[]): Promise<number> {
  let changed = 0
  for (const outcome of payloads.map(classifyBrevoEvent)) {
    if (!outcome) continue
    const ids = [outcome.messageId, `<${outcome.messageId}>`]
    const [result] =
      outcome.status === 'delivered'
        ? await pool.query(
            `UPDATE email_logs SET status = 'delivered' WHERE provider_message_id IN (?, ?) AND status = 'sent'`,
            ids,
          )
        : await pool.query(
            `UPDATE email_logs SET status = 'bounced', error_message = ?
             WHERE provider_message_id IN (?, ?) AND status IN ('sent', 'delivered')`,
            [outcome.reason, ...ids],
          )
    changed += (result as { affectedRows?: number }).affectedRows ?? 0
  }
  return changed
}
