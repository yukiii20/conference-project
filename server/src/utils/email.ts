import type { PoolConnection } from 'mysql2/promise'

type QueueEmailInput = {
  userId: string | null
  conferenceId?: string | null
  recipientEmail: string
  templateKey: string
  subject: string
  templateData: Record<string, unknown>
  entityType?: string | null
  entityId?: string | null
}

/**
 * The only way any code in this app sends email: inserts a 'queued' row into
 * email_logs. server/src/email/worker.ts picks it up, renders the body from
 * email_templates, and actually sends it (or prints it, in console mode) —
 * see that module for the "why" behind the two-step design. Returns the new
 * row's id (most callers ignore it; bulk email links it from
 * bulk_email_recipients so per-recipient delivery status can be read live).
 */
export async function queueEmail(conn: PoolConnection, input: QueueEmailInput): Promise<number> {
  const [result] = await conn.query(
    `INSERT INTO email_logs (conference_id, user_id, recipient_email, template_key, subject, template_data, entity_type, entity_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    [
      input.conferenceId ?? null,
      input.userId,
      input.recipientEmail,
      input.templateKey,
      input.subject,
      JSON.stringify(input.templateData),
      input.entityType ?? null,
      input.entityId ?? null,
    ],
  )
  return (result as { insertId: number }).insertId
}

/** Fills {{placeholder}} tokens in an email_templates subject with plain string replacement (used for the subject only — the worker HTML-escapes the body separately). */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = data[key]
    return value === undefined || value === null ? match : String(value)
  })
}
