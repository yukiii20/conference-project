import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../utils/errors.js'
import { assertSafeKey, contentTypeFor, storage, type StorageArea, type StoredObject } from './driver.js'

/** Machine-readable code on every "the database row exists but the file is gone" 404. */
export const FILE_MISSING_CODE = 'file_missing'

export const FILE_MISSING_MESSAGE = 'This file is missing from storage. Please ask the author to upload it again.'

/** A 404 for a file whose record exists but whose bytes are not in storage (e.g. lost on a redeploy). */
export class FileMissingError extends AppError {
  constructor(message = FILE_MISSING_MESSAGE) {
    super(404, message, undefined, FILE_MISSING_CODE)
  }
}

/**
 * Public files (logos, banners, photos) can be replaced, and a browser must notice the new
 * version within the hour - so a short max-age plus an ETag, never `immutable`. (Before this,
 * `immutable` + 7 days let the uploader's own browser keep showing a picture that had already
 * vanished from the server, which looked like "only the uploader can see it".)
 */
export const PUBLIC_FILE_CACHE_CONTROL = 'public, max-age=3600'

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** True when the request's If-None-Match already names this version (weak comparison, RFC 9110). */
export function etagMatches(ifNoneMatch: string | undefined, etag: string | null | undefined): boolean {
  if (!ifNoneMatch || !etag) return false
  const strip = (tag: string) => tag.trim().replace(/^W\//, '')
  const current = strip(etag)
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || strip(tag) === current)
}

function pipeToResponse(object: StoredObject, res: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    object.stream.on('error', reject)
    res.on('finish', resolve)
    res.on('close', resolve)
    object.stream.pipe(res)
  })
}

/**
 * Streams a stored file to the response. Callers must have checked permission first.
 * A missing file becomes a clean 404 (code `file_missing`) instead of a crash.
 */
export async function sendStoredFile(
  res: Response,
  area: StorageArea,
  key: string,
  options: { filename: string; disposition?: 'attachment' | 'inline'; contentType?: string; missingMessage?: string },
): Promise<void> {
  const object = await storage().open(area, key)
  if (!object) throw new FileMissingError(options.missingMessage)
  res.setHeader('Content-Type', options.contentType ?? object.contentType ?? contentTypeFor(key))
  res.setHeader('Content-Disposition', contentDisposition(options.disposition ?? 'attachment', options.filename))
  if (object.size != null) res.setHeader('Content-Length', String(object.size))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Private files are permission-checked per request: never let a shared cache keep one.
  res.setHeader('Cache-Control', 'private, no-store')
  await pipeToResponse(object, res)
}

export function sendPrivateFile(
  res: Response,
  key: string,
  filename: string,
  contentType?: string,
  options: { disposition?: 'attachment' | 'inline'; missingMessage?: string } = {},
): Promise<void> {
  return sendStoredFile(res, 'private', key, { filename, contentType, ...options })
}

/** Sends bytes that were built in memory (e.g. a certificate PDF generated on request). */
export function sendBuffer(
  res: Response,
  body: Buffer,
  options: { filename: string; contentType: string; disposition?: 'attachment' | 'inline' },
): void {
  res.setHeader('Content-Type', options.contentType)
  res.setHeader('Content-Disposition', contentDisposition(options.disposition ?? 'attachment', options.filename))
  res.setHeader('Content-Length', String(body.length))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(body)
}

/**
 * GET/HEAD /files/public/<key>, for every storage driver: streamed from local disk or from the
 * bucket, with the right content type, a short cache and an ETag (304 when unchanged).
 */
export async function publicFileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Mounted as app.get('/files/public/*'): the key is the wildcard part (Express 4 puts it in
    // params[0]), already URL-decoded by Express.
    const key = (req.params as Record<string, string | undefined>)[0] ?? ''
    try {
      assertSafeKey(key)
    } catch {
      res.status(404).json({ error: { message: 'Not found.' } })
      return
    }
    const object = await storage().open('public', key)
    if (!object) {
      // Never cached, so the picture shows up as soon as someone uploads it again.
      res.setHeader('Cache-Control', 'no-store')
      res.status(404).json({ error: { message: 'This image is missing from storage. Please upload it again.', code: FILE_MISSING_CODE } })
      return
    }
    res.setHeader('Cache-Control', PUBLIC_FILE_CACHE_CONTROL)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (object.etag) res.setHeader('ETag', object.etag)
    if (object.lastModified) res.setHeader('Last-Modified', object.lastModified.toUTCString())
    if (etagMatches(req.get('if-none-match'), object.etag)) {
      object.stream.destroy()
      res.status(304).end()
      return
    }
    res.setHeader('Content-Type', object.contentType ?? contentTypeFor(key))
    if (object.size != null) res.setHeader('Content-Length', String(object.size))
    if (req.method === 'HEAD') {
      object.stream.destroy()
      res.status(200).end()
      return
    }
    object.stream.on('error', next)
    object.stream.pipe(res)
  } catch (err) {
    next(err)
  }
}
