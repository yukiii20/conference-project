import type { NextFunction, Request, Response } from 'express'
import { NotFoundError } from '../utils/errors.js'
import { assertSafeKey, contentTypeFor, storage, type StorageArea } from './driver.js'

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/**
 * Streams a stored file to the response. Callers must have checked permission first.
 * A missing file becomes a clean 404 instead of a crash.
 */
export async function sendStoredFile(
  res: Response,
  area: StorageArea,
  key: string,
  options: { filename: string; disposition?: 'attachment' | 'inline'; contentType?: string },
): Promise<void> {
  const object = await storage().open(area, key)
  if (!object) throw new NotFoundError('This file is no longer available. Please upload it again.')
  res.setHeader('Content-Type', options.contentType ?? object.contentType ?? contentTypeFor(key))
  res.setHeader('Content-Disposition', contentDisposition(options.disposition ?? 'attachment', options.filename))
  if (object.size != null) res.setHeader('Content-Length', String(object.size))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  await new Promise<void>((resolve, reject) => {
    object.stream.on('error', reject)
    res.on('finish', resolve)
    res.on('close', resolve)
    object.stream.pipe(res)
  })
}

export function sendPrivateFile(res: Response, key: string, filename: string, contentType?: string): Promise<void> {
  return sendStoredFile(res, 'private', key, { filename, contentType })
}

/** GET /files/public/<key> for the r2 driver (the local driver keeps express.static). */
export async function publicFileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Mounted as app.get('/files/public/*'): the key is the wildcard part (Express 4 puts it in
    // params[0]), already URL-decoded by Express.
    const key = (req.params as Record<string, string | undefined>)[0] ?? ''
    try {
      assertSafeKey(key)
    } catch {
      res.status(404).end()
      return
    }
    const object = await storage().open('public', key)
    if (!object) {
      res.status(404).end()
      return
    }
    res.setHeader('Content-Type', object.contentType ?? contentTypeFor(key))
    if (object.size != null) res.setHeader('Content-Length', String(object.size))
    // Keys contain a random UUID and are never overwritten, so they can be cached for good.
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    object.stream.on('error', next)
    object.stream.pipe(res)
  } catch (err) {
    next(err)
  }
}
