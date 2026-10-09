import type { PoolConnection } from 'mysql2/promise'

type QueueEmailInput = {
  userId: string | null
  recipientEmail: string
  templateKey: string
  subject: string
  templateData: Record<string, unknown>
  entityType?: string | null
  entityId?: string | null
}

/**
 * Email sending is not wired up yet. In development we print the message to
 * the server console (so a developer can click the link) and record it in
 * email_logs as 'queued', exactly like a real provider integration will once
 * it exists — only the actual delivery step is missing.
 */
export async function queueEmail(conn: PoolConnection, input: QueueEmailInput): Promise<void> {
  await conn.query(
    `INSERT INTO email_logs (conference_id, user_id, recipient_email, template_key, subject, template_data, entity_type, entity_id, status)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    [
      input.userId,
      input.recipientEmail,
      input.templateKey,
      input.subject,
      JSON.stringify(input.templateData),
      input.entityType ?? null,
      input.entityId ?? null,
    ],
  )

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n--- [dev email] ${input.templateKey} -> ${input.recipientEmail} ---`)
    console.log(`Subject: ${input.subject}`)
    console.log(JSON.stringify(input.templateData, null, 2))
    console.log('--- end dev email ---\n')
  }
}

/** Fills {{placeholder}} tokens in an email_templates body/subject with plain string replacement. */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = data[key]
    return value === undefined || value === null ? match : String(value)
  })
}
