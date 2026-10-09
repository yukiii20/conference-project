export const PLATFORM_NAME = 'Conference CMS'

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/** Wraps a template's already-rendered inner HTML in one simple, consistent layout. */
export function wrapEmailHtml(innerHtml: string): string {
  const name = escapeHtml(PLATFORM_NAME)
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#2747A0;color:#ffffff;padding:16px 24px;font-size:16px;font-weight:bold;">${name}</td>
            </tr>
            <tr>
              <td style="padding:24px;color:#18181b;font-size:14px;line-height:1.6;">${innerHtml}</td>
            </tr>
            <tr>
              <td style="padding:16px 24px;color:#71717a;font-size:12px;border-top:1px solid #e4e4e7;">
                This is an automated message from ${name}. Please do not reply.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** A simple, good-enough plain-text fallback derived from the rendered HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
