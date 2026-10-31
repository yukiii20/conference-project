export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/**
 * Emails that carry a `sign_in_url` (role approved, invited to a conference)
 * must point at that conference's OWN sign-in page. Templates already stored
 * in a database don't mention {{sign_in_url}}, so the link is appended here
 * unless the template places it itself — no template data change needed.
 */
export function appendSignInLink(renderedHtml: string, rawTemplate: string, data: Record<string, unknown>): string {
  const url = data.sign_in_url
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return renderedHtml
  if (rawTemplate.includes('{{sign_in_url}}')) return renderedHtml
  const conferenceName = typeof data.conference_name === 'string' ? data.conference_name : 'your conference'
  return `${renderedHtml}<p><a href="${escapeHtml(url)}">Sign in to ${escapeHtml(conferenceName)}</a></p>`
}

/** Fills {{placeholder}} tokens in an email body, HTML-escaping every value — unlike utils/email.ts's renderTemplate (used only for plain-text subjects). */
export function renderHtmlTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = data[key]
    return value === undefined || value === null ? match : escapeHtml(value)
  })
}
