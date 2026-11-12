/**
 * Downloads a permission-checked file (submission file, certificate PDF, ...) without leaving
 * the page, and turns any failure into a sentence the person can act on. A plain
 * <a href download> can't do that: when the file is missing from storage the browser would
 * just show a raw JSON error page.
 */

/** The filename from a Content-Disposition header (prefers the UTF-8 filename* form). */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // fall through to the plain filename
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header)
  const name = (plain?.[1] ?? plain?.[2])?.trim()
  return name || null
}

/** The message to show for a failed download response body. */
export function downloadErrorMessage(status: number, body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  if (typeof message === 'string' && message) return message
  if (status === 401) return 'Your session has expired. Please sign in again to download this file.'
  if (status === 403) return 'You do not have permission to download this file.'
  if (status === 404) return 'This file is missing from storage. Please ask the author to upload it again.'
  if (status >= 500) return 'The server could not send this file right now. Please try again in a moment.'
  return 'Could not download this file. Please try again.'
}

/** Fetches `url` and saves it. Resolves to an error message, or null on success. */
export async function downloadFile(url: string, fallbackFilename: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'include' })
  } catch {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (!res.ok) {
    const body = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null
    return downloadErrorMessage(res.status, body)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filenameFromDisposition(res.headers.get('content-disposition')) ?? fallbackFilename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  return null
}
