import sanitizeHtml from 'sanitize-html'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import type { PlatformSettingsInput } from './validation.js'

const SETTINGS_KEY = 'platform'

export type PlatformSettings = {
  platform_name: string
  support_email: string | null
  footer_text: string | null
  hero_headline: string | null
  hero_subheadline: string | null
  faq_items: Array<{ q: string; a: string }>
  notify_admins_of_suggestions: boolean
}

// The site's current hardcoded copy (src/content/site.ts) — what every
// conference sees until an admin overrides it from Platform settings.
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  platform_name: 'Conference Management System',
  support_email: 'conferencemanagment4@gmail.com',
  footer_text:
    'A platform for running academic conferences — calls for papers, peer review, programme and participants.',
  hero_headline: 'Run your academic conference in one place',
  hero_subheadline:
    'Calls for papers, peer review, programme and participants, from first abstract to final session.',
  faq_items: [
    {
      q: 'How do I submit an abstract?',
      a: 'Sign up and choose "Author" for the conference you want to submit to. Once the convenor approves your account, go to your Author dashboard, choose "New abstract" and fill in the track, title, abstract and keywords — you can type the abstract, upload a file, or both.',
    },
    {
      q: 'Who can see my paper?',
      a: "Review is double-blind: reviewers see only your submission's content, never your name or affiliation. The convenor of that conference can see full submission details, since they manage the process.",
    },
    {
      q: 'How long does review take?',
      a: "Review timelines are set by each conference's own organisers. Check that conference's Key dates section for the review period and other deadlines.",
    },
    {
      q: 'Can I edit after submitting?',
      a: 'You can edit freely while your submission is a draft. Once you submit it for review, it is locked — you can withdraw it, but only before a decision is made. If a revision is requested, it reopens for editing.',
    },
    {
      q: 'How do I become a reviewer?',
      a: 'Sign up and choose "Reviewer" for the conference, or add the reviewer role to an existing account from your profile flow. The conference\'s convenor reviews and approves every reviewer request before it becomes active.',
    },
    {
      q: 'I forgot my password.',
      a: 'Use the "Forgot password?" link on the sign-in page. We\'ll email you a secure link to set a new one.',
    },
    {
      q: 'How do I organise a conference on this platform?',
      a: "Conferences are set up by our team. Contact us with your conference's details and we'll create it and set you up as the convenor so you can take it from there.",
    },
  ],
  notify_admins_of_suggestions: true,
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const [rows] = await pool.query('SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1', [
    SETTINGS_KEY,
  ])
  const row = (rows as Array<{ setting_value: unknown }>)[0]
  if (!row) return DEFAULT_PLATFORM_SETTINGS

  const stored = (typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : row.setting_value) as Partial<PlatformSettings>
  return { ...DEFAULT_PLATFORM_SETTINGS, ...stored }
}

function stripHtml(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()
}

export async function updatePlatformSettings(
  actorUserId: string,
  input: PlatformSettingsInput,
  ctx: AuditContext = {},
): Promise<PlatformSettings> {
  const clean: PlatformSettings = {
    platform_name: stripHtml(input.platform_name),
    support_email: input.support_email,
    footer_text: input.footer_text ? stripHtml(input.footer_text) : null,
    hero_headline: input.hero_headline ? stripHtml(input.hero_headline) : null,
    hero_subheadline: input.hero_subheadline ? stripHtml(input.hero_subheadline) : null,
    faq_items: input.faq_items.map((item) => ({ q: stripHtml(item.q), a: stripHtml(item.a) })),
    notify_admins_of_suggestions: input.notify_admins_of_suggestions,
  }

  const before = await getPlatformSettings()

  await withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `INSERT INTO platform_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [SETTINGS_KEY, JSON.stringify(clean), actorUserId],
    )
    await insertAuditLog(conn, {
      actorUserId,
      action: 'platform_settings.update',
      entityType: 'platform_settings',
      entityId: SETTINGS_KEY,
      oldValues: before,
      newValues: clean,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })

  return clean
}
