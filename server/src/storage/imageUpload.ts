import multer from 'multer'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { BadRequestError } from '../utils/errors.js'

// libvips' internal thread pool has been observed to crash the process under
// concurrent load in some environments (seen here as an intermittent native
// crash during the test suite). Serializing sharp's own worker threads is the
// documented mitigation and costs nothing at our upload volumes.
sharp.concurrency(1)

const ALLOWED_IMAGE_MIME_TO_EXT: Record<string, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** memoryStorage + a single `file` field; the route wires the size limit per asset kind. */
export function imageUpload(maxBytes: number) {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single('file')
}

export type ProcessedImage = { buffer: Buffer; ext: 'png' | 'jpg' | 'webp' }

/**
 * Validates the real file type from its magic bytes (never the browser's
 * Content-Type claim or the filename extension — that's what catches a PNG
 * renamed .pdf or an .exe renamed .png), then re-encodes with sharp, which
 * strips all metadata (EXIF, ICC, ...) by default. `square` additionally
 * crops/resizes to a fixed size (used for profile photos).
 */
export async function processImage(buffer: Buffer, options: { square?: number } = {}): Promise<ProcessedImage> {
  const sniffed = await fileTypeFromBuffer(buffer)
  const ext = sniffed ? ALLOWED_IMAGE_MIME_TO_EXT[sniffed.mime] : undefined
  if (!ext) {
    throw new BadRequestError('Use a PNG, JPEG, or WEBP image.')
  }

  let pipeline = sharp(buffer, { failOn: 'none' }).rotate()
  if (options.square) {
    pipeline = pipeline.resize(options.square, options.square, { fit: 'cover', position: 'attention' })
  }

  const outBuffer =
    ext === 'png'
      ? await pipeline.png().toBuffer()
      : ext === 'webp'
        ? await pipeline.webp().toBuffer()
        : await pipeline.jpeg({ quality: 90 }).toBuffer()

  return { buffer: outBuffer, ext }
}
