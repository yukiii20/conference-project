export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/** Fills {{placeholder}} tokens in an email body, HTML-escaping every value — unlike utils/email.ts's renderTemplate (used only for plain-text subjects). */
export function renderHtmlTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = data[key]
    return value === undefined || value === null ? match : escapeHtml(value)
  })
}
