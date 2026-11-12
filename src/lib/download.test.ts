import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadErrorMessage, downloadFile, filenameFromDisposition } from './download'

describe('filenameFromDisposition', () => {
  it('prefers the UTF-8 filename*', () => {
    expect(filenameFromDisposition(`attachment; filename="R_sum_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`)).toBe('Résumé.pdf')
  })
  it('falls back to the quoted or bare filename', () => {
    expect(filenameFromDisposition('attachment; filename="paper v2.pdf"')).toBe('paper v2.pdf')
    expect(filenameFromDisposition('attachment; filename=paper.pdf')).toBe('paper.pdf')
  })
  it('returns null when there is none', () => {
    expect(filenameFromDisposition(null)).toBeNull()
    expect(filenameFromDisposition('inline')).toBeNull()
  })
})

describe('downloadErrorMessage', () => {
  it("shows the server's own sentence when there is one", () => {
    expect(downloadErrorMessage(404, { error: { message: 'This file is missing from storage. Please ask the author to upload it again.' } })).toBe(
      'This file is missing from storage. Please ask the author to upload it again.',
    )
  })
  it('has a clear sentence for each status otherwise', () => {
    expect(downloadErrorMessage(404, null)).toMatch(/missing from storage/)
    expect(downloadErrorMessage(401, null)).toMatch(/sign in again/)
    expect(downloadErrorMessage(403, null)).toMatch(/permission/)
    expect(downloadErrorMessage(502, null)).toMatch(/try again/)
  })
})

describe('downloadFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the missing-file message instead of navigating to a JSON error page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'This file is missing from storage. Please ask the author to upload it again.', code: 'file_missing' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })),
    )
    expect(await downloadFile('/api/x', 'x.pdf')).toMatch(/missing from storage/)
  })

  it('returns a connection message when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await downloadFile('/api/x', 'x.pdf')).toMatch(/Could not reach the server/)
  })
})
