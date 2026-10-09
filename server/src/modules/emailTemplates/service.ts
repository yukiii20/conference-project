import sanitizeHtml from 'sanitize-html'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { htmlToText, wrapEmailHtml } from '../../email/layout.js'
import { renderHtmlTemplate } from '../../email/render.js'
import { insertAuditLog } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import type { SaveEmailTemplateInput } from './validation.js'

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  disallowedTagsMode: 'discard',
}

export function sanitizeTemplateHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}

type DefaultTemplateRow = { template_key: string; subject: string; body_html: string }
type OverrideTemplateRow = { template_key: string; subject: string; body_html: string }

export type EmailTemplateSummary = {
  template_key: string
  subject: string
  body_html: string
  is_customized: boolean
  placeholders: string[]
}

function extractPlaceholders(...texts: string[]): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    for (const match of text.matchAll(/\{\{(\w+)\}\}/g)) {
      found.add(match[1]!)
    }
  }
  return Array.from(found).sort()
}

async function loadDefaults(): Promise<DefaultTemplateRow[]> {
  const [rows] = await pool.query(
    `SELECT template_key, subject, body_html FROM email_templates WHERE conference_id IS NULL ORDER BY template_key`,
  )
  return rows as DefaultTemplateRow[]
}

export async function listEmailTemplates(conferenceId: string): Promise<EmailTemplateSummary[]> {
  const defaults = await loadDefaults()
  const [overrideRows] = await pool.query(
    `SELECT template_key, subject, body_html FROM email_templates WHERE conference_id = ?`,
    [conferenceId],
  )
  const overrides = new Map((overrideRows as OverrideTemplateRow[]).map((r) => [r.template_key, r]))

  return defaults.map((d) => {
    const override = overrides.get(d.template_key)
    const subject = override?.subject ?? d.subject
    const body_html = override?.body_html ?? d.body_html
    return {
      template_key: d.template_key,
      subject,
      body_html,
      is_customized: Boolean(override),
      placeholders: extractPlaceholders(d.subject, d.body_html),
    }
  })
}

async function getDefaultTemplate(templateKey: string): Promise<DefaultTemplateRow> {
  const [rows] = await pool.query(
    `SELECT template_key, subject, body_html FROM email_templates WHERE conference_id IS NULL AND template_key = ? LIMIT 1`,
    [templateKey],
  )
  const row = (rows as DefaultTemplateRow[])[0]
  if (!row) throw new NotFoundError('This email template does not exist.')
  return row
}

export async function saveEmailTemplate(
  actorUserId: string,
  conferenceId: string,
  templateKey: string,
  input: SaveEmailTemplateInput,
): Promise<void> {
  await getDefaultTemplate(templateKey) // 404s on an unknown key before writing anything
  const cleanBody = sanitizeTemplateHtml(input.body_html)

  await withTransaction(actorUserId, async (conn) => {
    const [existingRows] = await conn.query(
      `SELECT id FROM email_templates WHERE conference_id = ? AND template_key = ? LIMIT 1 FOR UPDATE`,
      [conferenceId, templateKey],
    )
    const existingId = (existingRows as Array<{ id: string }>)[0]?.id

    if (existingId) {
      await conn.query('UPDATE email_templates SET subject = ?, body_html = ? WHERE id = ?', [
        input.subject,
        cleanBody,
        existingId,
      ])
    } else {
      await conn.query(
        `INSERT INTO email_templates (conference_id, template_key, subject, body_html) VALUES (?, ?, ?, ?)`,
        [conferenceId, templateKey, input.subject, cleanBody],
      )
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'email_template.save',
      entityType: 'email_templates',
      entityId: templateKey,
      newValues: { subject: input.subject },
    })
  })
}

export async function resetEmailTemplate(actorUserId: string, conferenceId: string, templateKey: string): Promise<void> {
  await getDefaultTemplate(templateKey)
  await withTransaction(actorUserId, async (conn) => {
    const [result] = await conn.query('DELETE FROM email_templates WHERE conference_id = ? AND template_key = ?', [
      conferenceId,
      templateKey,
    ])
    if ((result as { affectedRows: number }).affectedRows === 0) return

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'email_template.reset',
      entityType: 'email_templates',
      entityId: templateKey,
    })
  })
}

const SAMPLE_VALUES: Record<string, string> = {
  platform_name: 'Conference CMS',
  full_name: 'Jordan Lee',
  conference_name: 'International Conference on Sample Research 2026',
  conference_code: 'ICSR26',
  role_name: 'reviewer',
  title: 'A Sample Paper Title',
  submission_code: 'ICSR26-0042',
  due_at: '15 Dec 2026, 5:00 PM',
  deadline: '15 Dec 2026',
  deadline_name: 'Full paper submission',
  starts_at: '20 Dec 2026, 10:00 AM',
  room_name: 'Hall A',
  body: 'This is a sample announcement body.',
  amount: '2,500',
  currency: 'NPR',
  registration_number: 'REG-0042',
  certificate_type: 'Participation',
  certificate_number: 'CERT-0042',
  reason: 'Sample reason text.',
}

function sampleValueFor(key: string): string {
  if (SAMPLE_VALUES[key]) return SAMPLE_VALUES[key]
  if (/_url$|_link$/.test(key)) return 'https://example.com/sample-link'
  if (/email/.test(key)) return 'sample@example.com'
  return `Sample ${key.replace(/_/g, ' ')}`
}

export async function previewEmailTemplate(
  conferenceId: string,
  templateKey: string,
): Promise<{ subject: string; html: string; text: string }> {
  const templates = await listEmailTemplates(conferenceId)
  const template = templates.find((t) => t.template_key === templateKey)
  if (!template) throw new NotFoundError('This email template does not exist.')

  const sampleData: Record<string, string> = {}
  for (const key of template.placeholders) {
    sampleData[key] = sampleValueFor(key)
  }

  const subject = renderHtmlTemplate(template.subject, sampleData).replace(/<[^>]+>/g, '')
  const html = wrapEmailHtml(renderHtmlTemplate(template.body_html, sampleData))
  return { subject, html, text: htmlToText(html) }
}
